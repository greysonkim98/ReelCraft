"""Prototype: several real clips -> one reel of a chosen length (default 10 s), using
OpenCV quality metrics + SigLIP 2 image embeddings/aesthetic prompts. Not wired into the app.

    python scripts/audit/pick_reel.py [--src .scratch/real] [--target 10] [--out .scratch/real-out] [--siglip on|off]

--siglip off skips the model entirely: no aesthetic score and no diversity penalty, and the OpenCV
weights are rescaled to sum to 1 so scores stay comparable. Outputs get a `_siglip-on|off` suffix.

Pipeline: ffmpeg 1 frame/sec (384 high, rotation applied) -> OpenCV sharpness/exposure/motion
-> SigLIP 2 (prompt score + embedding) -> greedy pick with a diversity penalty -> ffmpeg render
(720x1280, 30 fps, H.264/AAC, same scale/crop approach as frontend/lib/ffmpeg/render.ts).
"""
import argparse, json, math, subprocess, time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

MODEL = "google/siglip2-base-patch16-224"
MIN_SEG = 0.8  # same as ANALYSIS.minCandidateSeconds
W_SHARP, W_EXPO, W_MOTION, W_AESTH = 0.30, 0.15, 0.15, 0.40
DIVERSITY = 0.5  # penalty weight on similarity to already-picked segments

GOOD = ["a beautiful, well-composed photo", "a sharp, vivid, interesting scene"]
BAD = ["a blurry photo", "a very dark photo", "a photo of the floor or ground", "a photo of a blank wall"]


def feats(x):
    """transformers 5.x returns an output object from get_*_features; 4.x returned the tensor."""
    return x.pooler_output if hasattr(x, "pooler_output") else x


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{r.stderr[-800:]}")
    return r.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).strip())


def extract_frames(clip, idx, frames_dir):
    """1 frame per second, 384 high (PNG: 384px JPEG crashes the wasm core, keep the same choice here)."""
    pattern = frames_dir / f"c{idx:02d}_%03d.png"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-vf", "fps=1,scale=-2:384", str(pattern)])
    return sorted(frames_dir.glob(f"c{idx:02d}_*.png"))


def exposure_score(y):  # constants.ts: good 60..190, zero at 16 / 235
    if 60 <= y <= 190:
        return 1.0
    if y < 60:
        return max(0.0, (y - 16) / 44)
    return max(0.0, (235 - y) / 45)


def motion_score(d):  # constants.ts: bell curve, target 4, sigma 4
    return math.exp(-((d - 4) ** 2) / (2 * 4 ** 2))


def clip_motion(clip, start, end):
    """Mean abs diff between gray 160px frames sampled every ~0.1 s inside [start, end)."""
    cap = cv2.VideoCapture(str(clip))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(fps / 10))
    prev, diffs, n = None, [], int(start * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, n)
    while n < int(end * fps):
        ok, f = cap.read()
        if not ok:
            break
        if (n - int(start * fps)) % step == 0:
            g = cv2.cvtColor(cv2.resize(f, (160, 120)), cv2.COLOR_BGR2GRAY).astype(np.float32)
            if prev is not None:
                diffs.append(float(np.abs(g - prev).mean()))
            prev = g
        n += 1
    cap.release()
    return float(np.mean(diffs)) if diffs else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".scratch/real")
    ap.add_argument("--target", type=float, default=10.0)
    ap.add_argument("--out", default=".scratch/real-out")
    ap.add_argument("--siglip", choices=["on", "off"], default="on")
    a = ap.parse_args()
    use_siglip = a.siglip == "on"
    src, out = Path(a.src), Path(a.out)
    frames_dir = out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    clips = sorted(p for p in src.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"})
    timing = {}

    # 1. candidate segments = 1-second windows
    t0 = time.time()
    segs = []
    for i, clip in enumerate(clips):
        dur = duration(clip)
        for k, fr in enumerate(extract_frames(clip, i, frames_dir)):
            start, end = float(k), min(float(k + 1), dur)
            if end - start >= MIN_SEG:
                segs.append({"clip": i, "name": clip.name, "start": start, "end": end, "frame": fr})
    timing["extract_frames_s"] = round(time.time() - t0, 2)
    print(f"{len(clips)} clips, {len(segs)} candidate 1-s segments")

    # 2. OpenCV metrics
    t0 = time.time()
    for s in segs:
        img = cv2.imread(str(s["frame"]))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s["sharp_raw"] = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        s["yavg"] = float(gray.mean())
        s["motion_raw"] = clip_motion(clips[s["clip"]], s["start"], s["end"])
    top = max(math.log1p(s["sharp_raw"]) for s in segs)
    for s in segs:
        s["sharp"] = math.log1p(s["sharp_raw"]) / top
        s["expo"] = exposure_score(s["yavg"])
        s["motion"] = motion_score(s["motion_raw"])
    timing["opencv_s"] = round(time.time() - t0, 2)

    # 3. SigLIP 2 (optional)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    E = None
    if use_siglip:
        from transformers import AutoModel, AutoProcessor  # lazy: --siglip off must not need the model

        t0 = time.time()
        model = AutoModel.from_pretrained(MODEL).to(dev).eval()
        proc = AutoProcessor.from_pretrained(MODEL)
        timing["siglip_load_s"] = round(time.time() - t0, 2)
        t0 = time.time()
        prompts = GOOD + BAD
        with torch.no_grad():
            ti = proc(text=prompts, padding="max_length", max_length=64, return_tensors="pt").to(dev)
            temb = torch.nn.functional.normalize(feats(model.get_text_features(**ti)), dim=-1)
            embs = []
            for s in segs:
                ii = proc(images=Image.open(s["frame"]).convert("RGB"), return_tensors="pt").to(dev)
                e = torch.nn.functional.normalize(feats(model.get_image_features(**ii)), dim=-1)
                embs.append(e[0])
                sims = (e @ temb.T)[0] * 100
                p = torch.softmax(sims, dim=0)
                s["aesth"] = float(p[: len(GOOD)].sum())
        E = torch.stack(embs)
        timing["siglip_infer_s"] = round(time.time() - t0, 2)
        timing["siglip_ms_per_frame"] = round(timing["siglip_infer_s"] * 1000 / len(segs), 1)

    if use_siglip:
        w = (W_SHARP, W_EXPO, W_MOTION, W_AESTH)
    else:
        rest = W_SHARP + W_EXPO + W_MOTION
        w = (W_SHARP / rest, W_EXPO / rest, W_MOTION / rest, 0.0)
    for s in segs:
        s["score"] = w[0] * s["sharp"] + w[1] * s["expo"] + w[2] * s["motion"] + w[3] * s.get("aesth", 0.0)

    # 4. greedy pick with diversity penalty
    n_pick = max(1, round(a.target))
    picked = []
    sim = (E @ E.T).cpu().numpy() if use_siglip else None
    while len(picked) < min(n_pick, len(segs)):
        best, best_v = None, -1e9
        for j, s in enumerate(segs):
            if j in picked:
                continue
            pen = max((sim[j][p] for p in picked), default=0.0) if use_siglip else 0.0
            v = s["score"] - DIVERSITY * max(0.0, pen - 0.5)
            if v > best_v:
                best, best_v = j, v
        picked.append(best)
    picked.sort(key=lambda j: (segs[j]["clip"], segs[j]["start"]))  # chronological order
    chosen = [segs[j] for j in picked]

    # merge neighbours inside the same clip into one trim
    plan = []
    for s in chosen:
        if plan and plan[-1]["clip"] == s["clip"] and abs(plan[-1]["end"] - s["start"]) < 1e-6:
            plan[-1]["end"] = s["end"]
        else:
            plan.append({"clip": s["clip"], "name": s["name"], "start": s["start"], "end": s["end"]})

    # 5. render (720x1280 cover-crop, 30 fps, h264/aac)
    t0 = time.time()
    inputs, parts = [], []
    for k, p in enumerate(plan):
        inputs += ["-i", str(clips[p["clip"]])]
        parts.append(
            f"[{k}:v]trim=start={p['start']:.3f}:end={p['end']:.3f},setpts=PTS-STARTPTS,"
            f"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30[v{k}]"
        )
        parts.append(
            f"[{k}:a]atrim=start={p['start']:.3f}:end={p['end']:.3f},asetpts=PTS-STARTPTS,"
            f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{k}]"
        )
    parts.append("".join(f"[v{k}][a{k}]" for k in range(len(plan))) + f"concat=n={len(plan)}:v=1:a=1[v][a]")
    tag = f"siglip-{a.siglip}"
    reel = out / f"reel_{int(a.target)}s_{tag}.mp4"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(parts), "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart", str(reel)])
    timing["render_s"] = round(time.time() - t0, 2)

    # contact sheet of ALL candidates, picked ones framed in green
    thumbs = []
    for j, s in enumerate(segs):
        im = cv2.resize(cv2.imread(str(s["frame"])), (216, 288))
        if j in picked:
            im = cv2.copyMakeBorder(im[4:-4, 4:-4], 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=(0, 200, 0))
        cv2.putText(im, f"{s['clip']}:{s['start']:.0f} {s['score']:.2f}", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        thumbs.append(im)
    cols = 6
    while len(thumbs) % cols:
        thumbs.append(np.zeros_like(thumbs[0]))
    sheet = np.vstack([np.hstack(thumbs[r : r + cols]) for r in range(0, len(thumbs), cols)])
    cv2.imwrite(str(out / f"contact_sheet_{tag}.jpg"), sheet)

    info = {
        "siglip": use_siglip,
        "clips": [c.name for c in clips],
        "candidates": len(segs),
        "picked": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in segs[j].items() if k != "frame"} for j in picked],
        "plan": plan,
        "reel": str(reel),
        "timing": timing,
        "device": dev,
    }
    (out / f"result_{tag}.json").write_text(json.dumps(info, indent=2, ensure_ascii=False))
    print(json.dumps({"siglip": a.siglip, "plan": plan, "timing": timing, "device": dev}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
