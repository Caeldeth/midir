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
    error: null
  })
})

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
