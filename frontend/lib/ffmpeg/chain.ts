import { ANALYSIS } from './constants';
import { encoderThreadArgs, filterThreadArgs, inputThreadArgs } from './threads';

export interface AnalysisFilterSupport {
  scdet: boolean;
  blurdetect: boolean;
  freezedetect: boolean;
}

/** The single-pass analysis filter chain (spec 5.3), skipping filters the build lacks. */
export function analysisFilterChain(support: AnalysisFilterSupport): string {
  const chain: string[] = [];
  if (support.scdet) chain.push(`scdet=threshold=${ANALYSIS.scdetThreshold}`);
  if (support.blurdetect) chain.push('blurdetect=block_width=32:block_height=32');
  chain.push(`blackdetect=d=${ANALYSIS.blackDetect.minDuration}:pix_th=${ANALYSIS.blackDetect.pixTh}`);
  if (support.freezedetect) {
    chain.push(`freezedetect=n=${ANALYSIS.freezeDetect.noise}:d=${ANALYSIS.freezeDetect.duration}`);
  }
  chain.push('signalstats', 'metadata=print');
  return chain.join(',');
}

/** Fallback sharpness pass when blurdetect is missing: edge map → mean luma. */
export const EDGE_FALLBACK_CHAIN = 'edgedetect,signalstats,metadata=print';

export function proxyArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-y',
    ...inputThreadArgs,
    '-i',
    inputPath,
    ...filterThreadArgs,
    '-vf',
    `scale=-2:${ANALYSIS.proxyHeight},fps=${ANALYSIS.proxyFps}`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    String(ANALYSIS.proxyCrf),
    ...encoderThreadArgs,
    outputPath,
  ];
}

/** Analysis pass over the low-res proxy: decode → detectors → discard. */
export function metricsArgs(proxyPath: string, vf: string): string[] {
  return [...inputThreadArgs, '-i', proxyPath, ...filterThreadArgs, '-vf', vf, '-f', 'null', '-'];
}
