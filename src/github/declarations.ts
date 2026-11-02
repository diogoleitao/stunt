import type { GitHubClient } from "./client.ts";
import { dataOf, type GraphQLError, repositoryParameters, repositoryVariables } from "./graphql.ts";

// The file at $expression in each repository, by its owner and name. HEAD is
// the repository's default branch.
function declarationsQuery(count: number): string {
  const repositories = Array.from({ length: count }, (_, i) => i)
    .map(
      (i) => `
  repository${i}: repository(owner: $owner${i}, name: $name${i}) {
    object(expression: $expression) { ... on Blob { text } }
  }`,
    )
    .join("");
  return `query Declarations($expression: String!${repositoryParameters(count)}) {${repositories}
}`;
}

// A repository GitHub no longer finds, or the viewer cannot see, is null. A
// missing file, or a binary one, has no text.
type DeclarationsData = Record<`repository${number}`, { object: { text?: string | null } | null } | null | undefined>;

function isRepositoryNotFound(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND" && /^repository\d+$/.test(String(error.path?.[0]));
}

// The text of the file at `file` on the default branch of each of
// `repositories`, in one query, by repository. A repository without the file,
// or that GitHub does not find, is left out.
export async function fetchDeclarations(
  github: GitHubClient,
  repositories: string[],
  file: string,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (repositories.length === 0) return texts;
  const data = dataOf<DeclarationsData>(
    await github.graphql(declarationsQuery(repositories.length), {
      expression: `HEAD:${file}`,
      ...repositoryVariables(repositories),
    }),
    isRepositoryNotFound,
  );
  if (data === undefined) throw new Error("GitHub GraphQL response has no repositories");
  repositories.forEach((repository, i) => {
    const text = data[`repository${i}`]?.object?.text;
    if (typeof text === "string") texts.set(repository, text);
  });
  return texts;
}
