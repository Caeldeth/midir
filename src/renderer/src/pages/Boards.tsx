import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography
} from '@mui/material'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import Guidance from '@renderer/components/Guidance'
import { formatAgo, plural } from '@renderer/lib/format'
import { useBoardStore } from '@renderer/store/boardStore'
import type { BoardRecord, PostRecord } from '@shared/types'
import React, { useEffect, useMemo } from 'react'

/**
 * The board archive (WP36): every bulletin-board post and every mail the
 * player has seen, off the wire.
 *
 * The archive fills as the player browses. A post seen only in a list has a
 * header and no body; opening it in the game fills the body in. Nothing here
 * drives the game: the poll that reads a whole board is the next part of
 * WP36, and it lives on this tab when it lands.
 */

const LIST_WIDTH = 300

/** The name a board or a mailbox is listed under. */
function boardLabel(board: { name: string; mail: boolean; owner?: string; id: number }): string {
  if (board.mail) return `${board.owner ?? 'Someone'}'s mail`
  return board.name !== '' ? board.name : `Board ${board.id}`
}

/** The server sends a month and a day and no year. */
function postDate(post: PostRecord): string {
  return `${post.month}/${post.day}`
}

/** A body's line breaks as the client typed them: CR, CR LF, or LF (live, 2026-09-22). */
function bodyLines(body: string): string {
  return body.replace(/\r\n?/g, '\n')
}

function Boards(): React.JSX.Element {
  const boards = useBoardStore((s) => s.boards)
  const selected = useBoardStore((s) => s.selected)
  const board = useBoardStore((s) => s.board)
  const exportedTo = useBoardStore((s) => s.exportedTo)
  const error = useBoardStore((s) => s.error)
  const refresh = useBoardStore((s) => s.refresh)
  const select = useBoardStore((s) => s.select)
  const exportSelected = useBoardStore((s) => s.exportSelected)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Show the most recently seen board until the user picks another.
  useEffect(() => {
    if (selected === null && boards.length > 0) void select(boards[0]!.key)
  }, [selected, boards, select])

  if (boards.length === 0) {
    return (
      <Guidance
        title="No boards yet"
        detail="With capture on, open the mailbox or a board in the game. Every post and mail you see is kept here."
      />
    )
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box
        sx={{
          width: LIST_WIDTH,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          overflow: 'auto'
        }}
      >
        <List dense disablePadding data-testid="board-list">
          {boards.map((summary) => (
            <ListItemButton
              key={summary.key}
              selected={summary.key === selected}
              onClick={() => void select(summary.key)}
            >
              <ListItemText
                primary={boardLabel(summary)}
                secondary={`${plural(summary.postCount, 'post')}, ${summary.bodyCount} read · ${formatAgo(summary.seenAtMs)}`}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2.5 }}>
        {board === null ? (
          <Button onClick={() => void refresh()}>Reload</Button>
        ) : (
          <BoardView
            board={board}
            exportedTo={exportedTo}
            error={error}
            onExport={() => void exportSelected()}
          />
        )}
      </Box>
    </Box>
  )
}

interface BoardViewProps {
  board: BoardRecord
  exportedTo: string | null
  error: string | null
  onExport: () => void
}

function BoardView({ board, exportedTo, error, onExport }: BoardViewProps): React.JSX.Element {
  // Newest first, as the game lists them: post ids rise with time.
  const posts = useMemo(
    () => Object.values(board.posts).sort((a, b) => b.postId - a.postId),
    [board.posts]
  )
  const read = posts.filter((p) => p.body !== undefined).length

  return (
    <Box data-testid="board-view">
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h6" sx={{ color: 'text.button', fontWeight: 'bold', flex: 1 }}>
          {boardLabel(board)}
        </Typography>
        <Button variant="outlined" size="small" onClick={onExport} data-testid="board-export">
          Export JSON
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {plural(posts.length, 'post')} seen, {read} with the body read · last seen{' '}
        {formatAgo(board.seenAtMs)}.
        {posts.length > read
          ? ' A post with no body was seen in a list and not opened; open it in the game to read it here.'
          : ''}
      </Typography>
      {exportedTo !== null ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Exported to {exportedTo}.
        </Typography>
      ) : null}
      {error !== null ? (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {error}
        </Typography>
      ) : null}

      {posts.map((post) => (
        <Accordion key={post.postId} disableGutters data-testid="board-post">
          <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: post.highlighted ? 'bold' : undefined }}
              >
                {post.subject !== '' ? post.subject : '(no subject)'}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {post.author} · {postDate(post)} · #{post.postId}
                {post.body === undefined ? ' · not opened' : ''}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            {post.body === undefined ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Seen in the list on {postDate(post)} and not opened yet.
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {bodyLines(post.body)}
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  )
}

export default Boards
