import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useBoardStore } from '@renderer/store/boardStore'
import type { BoardRecord, BoardSummary } from '@shared/types'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Boards from '../Boards'

/** The Boards tab (WP36). */

const PUBLIC: BoardRecord = {
  key: '10',
  id: 10,
  name: 'Public',
  mail: false,
  seenAtMs: Date.now(),
  posts: {
    '42': {
      postId: 42,
      author: 'Ari',
      month: 7,
      day: 15,
      subject: 'Hello',
      highlighted: false,
      body: 'Welcome!\r\rSigned,\rAri',
      seenAtMs: Date.now(),
      bodyAtMs: Date.now(),
      seenBy: 'Sabrael'
    },
    '41': {
      postId: 41,
      author: 'Bran',
      month: 7,
      day: 14,
      subject: 'Older',
      highlighted: true,
      seenAtMs: Date.now(),
      seenBy: 'Sabrael'
    }
  }
}

const SUMMARY: BoardSummary = {
  key: '10',
  id: 10,
  name: 'Public',
  mail: false,
  postCount: 2,
  bodyCount: 1,
  seenAtMs: Date.now()
}

const MAIL: BoardSummary = {
  key: 'mail:Sabrael',
  id: 0,
  name: 'Mail',
  mail: true,
  owner: 'Sabrael',
  postCount: 1,
  bodyCount: 1,
  seenAtMs: Date.now() - 60_000
}

beforeEach(() => {
  useBoardStore.setState({
    boards: [],
    selected: null,
    board: null,
    loading: false,
    exportedTo: null,
    error: null,
    windows: [],
    pollWindow: '',
    onlyUnread: true,
    polls: {},
    lastPoll: undefined,
    pollError: null
  })
})

const WINDOW = { connectionId: 'c1', windowHandle: 7, title: 'Darkages', characterName: 'Evenue' }

describe('the Boards page', () => {
  it('tells the user what to do when nothing is archived', async () => {
    window.api.boards.list = vi.fn(async () => [])
    render(<Boards />)
    expect(await screen.findByText('No boards yet')).toBeInTheDocument()
  })

  it('lists the boards and shows the newest board with its posts, newest first', async () => {
    window.api.boards.list = vi.fn(async () => [SUMMARY, MAIL])
    window.api.boards.get = vi.fn(async () => PUBLIC)
    render(<Boards />)
    await screen.findByTestId('board-view')
    expect(screen.getByText("Sabrael's mail")).toBeInTheDocument()
    const posts = screen.getAllByTestId('board-post')
    expect(posts).toHaveLength(2)
    expect(posts[0]).toHaveTextContent('Hello')
    expect(posts[1]).toHaveTextContent('Older')
    expect(posts[1]).toHaveTextContent('not opened')
    expect(screen.getByText(/2 posts seen, 1 with the body read/)).toBeInTheDocument()
  })

  it("shows a body's carriage returns as line breaks", async () => {
    window.api.boards.list = vi.fn(async () => [SUMMARY])
    window.api.boards.get = vi.fn(async () => PUBLIC)
    render(<Boards />)
    await screen.findByTestId('board-view')
    await userEvent.click(screen.getAllByTestId('board-post')[0]!)
    const body = await screen.findByText(/Signed,/)
    expect(body.textContent).toBe('Welcome!\n\nSigned,\nAri')
  })

  it('exports the shown board and says where it went', async () => {
    window.api.boards.list = vi.fn(async () => [SUMMARY])
    window.api.boards.get = vi.fn(async () => PUBLIC)
    window.api.boards.exportJson = vi.fn(async () => 'C:/exports/Public.json')
    render(<Boards />)
    await screen.findByTestId('board-view')
    await userEvent.click(screen.getByTestId('board-export'))
    expect(window.api.boards.exportJson).toHaveBeenCalledWith('10')
    expect(await screen.findByText('Exported to C:/exports/Public.json.')).toBeInTheDocument()
  })
})

describe('the poll on the Boards page (WP36 PR2)', () => {
  it('offers the poll with no archive, and starts it on the picked window', async () => {
    window.api.boards.list = vi.fn(async () => [])
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    render(<Boards />)
    expect(await screen.findByText('No boards yet')).toBeInTheDocument()
    expect(screen.getByTestId('poll-start')).toBeDisabled()
    useBoardStore.getState().setPollWindow('c1')
    await userEvent.click(screen.getByTestId('poll-start'))
    expect(window.api.boards.poll).toHaveBeenCalledWith({
      connectionId: 'c1',
      scope: 'all',
      onlyUnread: true
    })
    await userEvent.click(screen.getByTestId('poll-open'))
    expect(window.api.boards.poll).toHaveBeenLastCalledWith({
      connectionId: 'c1',
      scope: 'open',
      onlyUnread: true
    })
    expect(await screen.findByTestId('poll-outcome')).toHaveTextContent('read 0 boards and 0 posts')
  })

  it('shows what a running poll is on, and stops it', async () => {
    window.api.boards.list = vi.fn(async () => [])
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    render(<Boards />)
    await screen.findByText('No boards yet')
    useBoardStore.setState({
      pollWindow: 'c1',
      polls: {
        c1: {
          connectionId: 'c1',
          running: true,
          doing: 'reading Rangers, post 3 of 48',
          boardsDone: 1,
          boardsTotal: 21,
          postsRead: 14
        }
      }
    })
    expect(await screen.findByTestId('poll-status')).toHaveTextContent('Board 2 of 21')
    expect(screen.getByTestId('poll-status')).toHaveTextContent('reading Rangers, post 3 of 48')
    await userEvent.click(screen.getByTestId('poll-stop'))
    expect(window.api.boards.stopPoll).toHaveBeenCalledWith('c1')
  })

  it('reads one board of the archive in the game, on the picked window', async () => {
    window.api.boards.list = vi.fn(async () => [SUMMARY])
    window.api.boards.get = vi.fn(async () => PUBLIC)
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    render(<Boards />)
    await screen.findByTestId('board-view')
    // No window picked: the button waits.
    expect(screen.getByTestId('board-read')).toBeDisabled()
    useBoardStore.getState().setPollWindow('c1')
    await userEvent.click(screen.getByTestId('board-read'))
    expect(window.api.boards.poll).toHaveBeenCalledWith({
      connectionId: 'c1',
      scope: { boardIds: [10] },
      onlyUnread: true
    })
  })
})
