export interface CommitInfo {
  oid: string
  parentOids: string[]
  author: string
  email: string
  timestamp: number
  message: string
  isMerge: boolean
}

export interface FileLineStats {
  filepath: string
  added: number
  deleted: number
}

export interface CommitStats {
  commit: CommitInfo
  files: FileLineStats[]
  totalAdded: number
  totalDeleted: number
}

export interface AuthorTotals {
  author: string
  commits: number
  added: number
  deleted: number
  net: number
}

export interface ActivityBucket {
  bucketStart: number
  author: string
  commits: number
  added: number
  deleted: number
}

export interface CommitPatternSummary {
  author: string
  avgLinesPerCommit: number
  largestCommit: { oid: string; lines: number }
  dayOfWeekCounts: number[]
  hourOfDayCounts: number[]
}

export interface FileOwnership {
  filepath: string
  totalLines: number
  ownerLineCounts: Record<string, number>
}

export interface AuthorOwnership {
  author: string
  linesOwned: number
  percentage: number
}

export interface BranchMergeInsights {
  author: string
  mergeCommits: number
}

export interface BranchUpstreamStatus {
  hasUpstream: boolean
  upstreamName?: string
  ahead: number
  behind: number
}

export interface HotspotEntry {
  filepath: string
  totalChurn: number
  authorCount: number
  score: number
}

export interface BusFactorEntry {
  filepath: string
  totalLines: number
  topAuthor: string
  topAuthorPercentage: number
}

export interface RepoAnalysis {
  repoName: string
  branch: string
  branches: string[]
  branchStatus: BranchUpstreamStatus
  headOid: string
  commits: CommitInfo[]
  commitStats: CommitStats[]
  authorTotals: AuthorTotals[]
  activity: ActivityBucket[]
  commitPatterns: CommitPatternSummary[]
  fileOwnership: FileOwnership[]
  authorOwnership: AuthorOwnership[]
  mergeInsights: BranchMergeInsights[]
}
