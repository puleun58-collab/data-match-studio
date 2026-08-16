import { Button, Heading, Section } from './ui';

export default function ProgressPanel({ progress, onCancel }: { progress?: { completed: number; total: number }; onCancel: () => void }) {
  if (!progress) return null;
  const percent = progress.total ? Math.round(progress.completed / progress.total * 100) : 0;

  return (
    <Section className="progress-panel" tone="surface" aria-live="polite" aria-busy="true">
      <Heading level={2} description="두 파일을 브라우저 안에서 비교하고 있습니다.">비교 진행 중</Heading>
      <progress value={progress.completed} max={Math.max(progress.total, 1)} aria-label={`비교 진행률 ${percent}%`} />
      <div className="progress-panel__meta">
        <p>{progress.completed.toLocaleString('ko-KR')} / {progress.total.toLocaleString('ko-KR')}행 ({percent}%)</p>
        <Button variant="danger" onClick={onCancel}>비교 취소</Button>
      </div>
    </Section>
  );
}
