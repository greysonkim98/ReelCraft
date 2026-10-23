export const dynamicParams = false;
export function generateStaticParams() {
  return ['clips', 'style', 'analyze', 'captions', 'voice', 'review', 'render', 'share'].map((stage) => ({
    stage,
  }));
}
export default function EditorStagePage() {
  return null;
}
