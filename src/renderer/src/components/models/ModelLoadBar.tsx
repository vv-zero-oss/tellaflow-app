import { Progress } from '@/components/ui/progress';

export function ModelLoadBar({ progress }: { progress: number }) {
  return (
    <div className="mt-3">
      <Progress value={progress} />
      <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
        <span>Loading into memory</span>
        <span>{progress}%</span>
      </div>
    </div>
  );
}
