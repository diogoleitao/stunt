import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReviewInboxRow } from "../stunt/page-model.ts";
import { Badge } from "./badge.tsx";

// A repository's Review inbox, oldest request first.
export function ReviewInboxTable({ prs }: { prs: ReviewInboxRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">PR</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Requested by</TableHead>
          <TableHead className="text-right">Requested</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {prs.map((pr) => (
          <TableRow key={pr.number}>
            <TableCell className="text-muted-foreground tabular-nums">#{pr.number}</TableCell>
            <TableCell className="max-w-0 w-full">
              <div className="flex items-center gap-2">
                <a href={pr.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                  {pr.title}
                </a>
                {pr.reRequest && (
                  <Badge className="border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                    re-request
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{pr.author}</TableCell>
            <TableCell className="text-muted-foreground">{pr.request?.by ?? "unknown"}</TableCell>
            <TableCell className="text-right text-muted-foreground">{pr.request?.ago ?? "unknown"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
