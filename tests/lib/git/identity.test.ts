import { describe, expect, it } from 'vitest'
import { parseMailmap, buildIdentityResolver } from '../../../src/lib/git/identity'
import type { CommitInfo } from '../../../src/lib/types'

function c(author: string, email: string): CommitInfo {
  return { oid: Math.random().toString(), parentOids: [], author, email, timestamp: 0, message: 'm', isMerge: false }
}

describe('parseMailmap', () => {
  it('parses "Proper Name <proper@email>" (name for an email)', () => {
    expect(parseMailmap('Proper Name <proper@x.com>')).toEqual([
      { properName: 'Proper Name', properEmail: 'proper@x.com' },
    ])
  })

  it('parses "<proper@email> <commit@email>" (email remap)', () => {
    expect(parseMailmap('<proper@x.com> <old@x.com>')).toEqual([
      { properEmail: 'proper@x.com', commitEmail: 'old@x.com' },
    ])
  })

  it('parses "Proper Name <proper@email> <commit@email>"', () => {
    expect(parseMailmap('Proper Name <proper@x.com> <old@x.com>')).toEqual([
      { properName: 'Proper Name', properEmail: 'proper@x.com', commitEmail: 'old@x.com' },
    ])
  })

  it('parses "Proper Name <proper@email> Commit Name <commit@email>"', () => {
    expect(parseMailmap('Proper Name <proper@x.com> Commit Name <old@x.com>')).toEqual([
      {
        properName: 'Proper Name',
        properEmail: 'proper@x.com',
        commitName: 'Commit Name',
        commitEmail: 'old@x.com',
      },
    ])
  })

  it('skips comments, blank lines, and malformed lines', () => {
    const text = [
      '# a comment',
      '',
      'Proper Name <proper@x.com>  # trailing comment',
      'garbage with no email',
      '   ',
    ].join('\n')
    expect(parseMailmap(text)).toEqual([{ properName: 'Proper Name', properEmail: 'proper@x.com' }])
  })
})

describe('buildIdentityResolver', () => {
  it('groups identities that share an email (no mailmap needed)', () => {
    const commits = [
      c('ravindu0823', 'guestpc87@gmail.com'),
      c('ravindu0823', 'guestpc87@gmail.com'),
      c('R R D Perera', 'guestpc87@gmail.com'),
    ]
    const resolver = buildIdentityResolver([], commits)
    // Both names resolve to the most frequent name for that shared email.
    expect(resolver.resolve('ravindu0823', 'guestpc87@gmail.com')).toBe('ravindu0823')
    expect(resolver.resolve('R R D Perera', 'guestpc87@gmail.com')).toBe('ravindu0823')
  })

  it('unites two emails into one person via a mailmap entry', () => {
    const entries = parseMailmap('PramodHashantha <primary@x.com> <secondary@x.com>')
    const commits = [c('PramodHashantha', 'primary@x.com'), c('Hashantha Pramod', 'secondary@x.com')]
    const resolver = buildIdentityResolver(entries, commits)
    expect(resolver.resolve('PramodHashantha', 'primary@x.com')).toBe('PramodHashantha')
    expect(resolver.resolve('Hashantha Pramod', 'secondary@x.com')).toBe('PramodHashantha')
  })

  it('matches emails case-insensitively', () => {
    const commits = [c('Alice', 'alice@x.com'), c('Alice', 'alice@x.com')]
    const resolver = buildIdentityResolver([], commits)
    expect(resolver.resolve('Alice', 'ALICE@X.COM')).toBe('Alice')
  })

  it('falls back to the raw name when the commit has no email', () => {
    const resolver = buildIdentityResolver([], [])
    expect(resolver.resolve('Nameless', '')).toBe('Nameless')
  })
})
