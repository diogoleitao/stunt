import type { GitHubClient } from './client.ts'
import { dataOf, type GraphQLError, repositoryParameters, repositoryVariables } from './graphql.ts'

// A Local Markdown repository's `.scratch` tree: the text of each file in the
// `issues` directory of each Feature directory, by file name, by Feature
// slug.
export type ScratchTree = Map<string, Map<string, string>>

// The `.scratch` tree at $expression in each repository, by its owner and
// name, three levels deep: Feature directories, the directories in each, and
// the text of the files in those. HEAD is the repository's default branch.
function scratchQuery (count: number): string {
  const repositories = Array.from({ length: count }, (_, i) => i)
    .map(
      (i) => `
  repository${i}: repository(owner: $owner${i}, name: $name${i}) {
    object(expression: $expression) { ...Scratch }
  }`
    )
    .join('')
  return `query Scratch($expression: String!${repositoryParameters(count)}) {${repositories}
}

fragment Scratch on Tree {
  entries {
    name
    object {
      ... on Tree {
        entries {
          name
          object {
            ... on Tree {
              entries {
                name
                object { ... on Blob { text } }
              }
            }
          }
        }
      }
    }
  }
}`
}

// Each level of the tree as GitHub returns it. An entry that is a file, not a
// directory, has an object with no entries, and a file in a Feature's
// directory has its text, unless it is binary.
type FileObject = { text?: string | null }
type FeatureDirectoryObject = { entries?: { name: string; object: FileObject }[] }
type FeatureObject = { entries?: { name: string; object: FeatureDirectoryObject }[] }
type ScratchObject = { entries?: { name: string; object: FeatureObject }[] }

// A repository GitHub no longer finds, or the viewer cannot see, is null. A
// repository without `.scratch` has no object, and one whose `.scratch` is a
// file has an object with no entries.
type ScratchData = Record<`repository${number}`, { object: ScratchObject | null } | null | undefined>

function isRepositoryNotFound (error: GraphQLError): boolean {
  return error.type === 'NOT_FOUND' && /^repository\d+$/.test(String(error.path?.[0]))
}

// The `.scratch` tree on the default branch of each of `repositories`, in
// one query, by repository. A repository without `.scratch`, or that GitHub
// does not find, is left out.
export async function fetchScratchTrees (
  github: GitHubClient,
  repositories: string[]
): Promise<Map<string, ScratchTree>> {
  const trees = new Map<string, ScratchTree>()
  if (repositories.length === 0) return trees
  const data = dataOf<ScratchData>(
    await github.graphql(scratchQuery(repositories.length), {
      expression: 'HEAD:.scratch',
      ...repositoryVariables(repositories),
    }),
    isRepositoryNotFound
  )
  if (data === undefined) throw new Error('GitHub GraphQL response has no repositories')
  repositories.forEach((repository, i) => {
    const scratch = data[`repository${i}`]?.object?.entries
    if (scratch === undefined) return
    const tree: ScratchTree = new Map()
    for (const feature of scratch) {
      // A file in `.scratch` is not a Feature.
      if (feature.object.entries === undefined) continue
      const issues = feature.object.entries.find((entry) => entry.name === 'issues')?.object.entries
      const texts = new Map<string, string>()
      for (const file of issues ?? []) {
        if (typeof file.object.text === 'string') texts.set(file.name, file.object.text)
      }
      tree.set(feature.name, texts)
    }
    trees.set(repository, tree)
  })
  return trees
}
