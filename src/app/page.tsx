import { connection } from 'next/server'
import { cn } from '@/lib/utils'
import type { OwnerRow } from '../stunt/page-model.ts'
import { appStunt } from './app-stunt.ts'

// The dashboard: a row of cards per owner, each card a repository's counts.
export default async function DashboardPage () {
  await connection()
  const model = await appStunt().pageModel()

  return (
    <div className='flex flex-col gap-6'>
      <h1 className='text-2xl font-semibold tracking-tight'>Dashboard</h1>
      {model.owners.length === 0
        ? (
            <p className='text-muted-foreground'>
              {model.checkedAt === undefined
                ? 'Waiting for the first check.'
                : 'No Assigned PRs, and your Review inbox is empty.'}
            </p>
          )
        : (
            model.owners.map((row) => <OwnerCards key={row.owner} row={row} />)
          )}
    </div>
  )
}

function OwnerCards ({ row }: { row: OwnerRow }) {
  return (
    <section className='flex min-w-0 flex-col gap-2'>
      <h2 className='text-lg font-medium'>{row.owner}</h2>
      <div className='flex gap-3 overflow-x-auto pb-2'>
        {row.repositories.map(({ name, counts }) => (
          <div key={name} className='flex w-56 shrink-0 flex-col gap-2 rounded-lg border p-4'>
            <span className='truncate font-medium'>{name.slice(row.owner.length + 1)}</span>
            <CardCount label='Assigned PRs' value={counts.assignedPRs} />
            <CardCount label='Review inbox' value={counts.reviewInbox} />
          </div>
        ))}
      </div>
    </section>
  )
}

function CardCount ({ label, value }: { label: string; value: number }) {
  return (
    <span className={cn('flex justify-between text-sm', value === 0 && 'text-muted-foreground')}>
      {label}
      <span className='tabular-nums'>{value}</span>
    </span>
  )
}
