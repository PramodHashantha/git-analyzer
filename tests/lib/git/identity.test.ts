import { describe, expect, it } from 'vitest'
import { parseMailmap } from '../../../src/lib/git/identity'

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
