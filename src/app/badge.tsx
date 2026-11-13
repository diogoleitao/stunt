import { cn } from '@/lib/utils'

export function Badge ({ className, children }: { className?: string; children: string }) {
  return (
    <span className={cn('inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium', className)}>
      {children}
    </span>
  )
}
