export type GraphQLError = { message: string; type?: string; path?: (string | number)[] }

// A response's data, failing on any error but those `ignored`.
export function dataOf<Data> (body: unknown, ignored: (error: GraphQLError) => boolean = () => false): Data | undefined {
  const { data, errors = [] } = body as { data?: Data; errors?: GraphQLError[] }
  const failures = errors.filter((error) => !ignored(error))
  if (failures.length > 0) {
    throw new Error(`GitHub GraphQL query failed: ${failures.map((error) => error.message).join('; ')}`)
  }
  return data
}

// The variable definitions naming `count` repositories by their index:
// $owner0 and $name0, $owner1 and $name1, and so on.
export function repositoryParameters (count: number): string {
  return Array.from({ length: count }, (_, i) => `, $owner${i}: String!, $name${i}: String!`).join('')
}

// The variable definitions naming `count` issues or PRs by their index:
// $owner0, $name0, and $number0, and so on.
export function issueParameters (count: number): string {
  return repositoryParameters(count) + Array.from({ length: count }, (_, i) => `, $number${i}: Int!`).join('')
}

// The values of those variables for `issues`, each by its `owner/repo` and
// number.
export function issueVariables (issues: { repository: string; number: number }[]): Record<string, unknown> {
  return {
    ...repositoryVariables(issues.map((issue) => issue.repository)),
    ...Object.fromEntries(issues.map(({ number }, i) => [`number${i}`, number])),
  }
}

// The values of those variables for `repositories`, each an `owner/repo`.
export function repositoryVariables (repositories: string[]): Record<string, string> {
  return Object.fromEntries(
    repositories.flatMap((repository, i) => {
      const [owner, name] = repository.split('/')
      return [
        [`owner${i}`, owner],
        [`name${i}`, name],
      ]
    })
  )
}
