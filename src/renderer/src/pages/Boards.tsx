import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import Guidance from '@renderer/components/Guidance'
import { formatAgo, plural } from '@renderer/lib/format'
import { boardPollOutcomeMessage, useBoardStore } from '@renderer/store/boardStore'
import { useCaptureStore } from '@renderer/store/captureStore'
import type { BoardRecord, BoardSummary, PostRecord } from '@shared/types'
import React, { useEffect, useMemo } from 'react'

/**
 * The board archive (WP36): every bulletin-board post and every mail the
 * player has seen, off the wire.
 *
 * The archive fills as the player browses. A post seen only in a list has a
 * header and no body; opening it in the game fills the body in. The poll at
 * the top reads every board and the mailbox end to end through the client's
 * own board pane (WP36 PR2): it presses W and the arrow keys, clicks rows,
 * View, and Up, and nothing that writes.
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <PollPanel />
      {boards.length === 0 ? (
        <Guidance
          title="No boards yet"
          detail="With capture on, open the mailbox or a board in the game. Every post and mail you see is kept here. Or press Read everything above, and Midir reads them all."
        />
      ) : (
        <Archive
          boards={boards}
          selected={selected}
          board={board}
          exportedTo={exportedTo}
          error={error}
          onSelect={(key) => void select(key)}
          onRefresh={() => void refresh()}
          onExport={() => void exportSelected()}
        />
      )}
    </Box>
  )
}

/**
 * The poll: one window, one button, and the line that says what it is on.
 * It ships off; nothing runs until the button is pressed.
 */
function PollPanel(): React.JSX.Element {
  const windows = useBoardStore((s) => s.windows)
  const pollWindow = useBoardStore((s) => s.pollWindow)
  const onlyUnread = useBoardStore((s) => s.onlyUnread)
  const polls = useBoardStore((s) => s.polls)
  const lastPoll = useBoardStore((s) => s.lastPoll)
  const pollError = useBoardStore((s) => s.pollError)
  const refreshWindows = useBoardStore((s) => s.refreshWindows)
  const setPollWindow = useBoardStore((s) => s.setPollWindow)
  const setOnlyUnread = useBoardStore((s) => s.setOnlyUnread)
  const poll = useBoardStore((s) => s.poll)
  const stopPoll = useBoardStore((s) => s.stopPoll)
  const captureStatus = useCaptureStore((s) => s.status)

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows, captureStatus])

  // A selection that names a window that is gone collapses to empty.
  const selectedValue = windows.some((w) => w.connectionId === pollWindow) ? pollWindow : ''
  const running = selectedValue !== '' ? polls[selectedValue] : undefined

  const windowLabel = (w: (typeof windows)[number]): string =>
    w.characterName !== undefined ? w.characterName : w.title || 'A game window'

  return (
    <Paper sx={{ m: 2.5, mb: 0, p: 2, flexShrink: 0 }} data-testid="board-poll">
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Read everything opens the board list with W and reads every board and the mailbox to the
        oldest post, through the game's own pane: the arrow keys, View, and Up, and nothing that
        writes. It stops on any dialog it did not open. A character must be logged in on the window.
      </Typography>
      {pollError !== null ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {pollError}
        </Alert>
      ) : null}
      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Game window"
          value={selectedValue}
          onChange={(event) => setPollWindow(event.target.value)}
          disabled={running !== undefined}
          sx={{ minWidth: 220 }}
        >
          {windows.map((w) => (
            <MenuItem key={w.connectionId} value={w.connectionId}>
              {windowLabel(w)}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" onClick={() => void refreshWindows()}>
          Refresh
        </Button>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={onlyUnread}
              onChange={(event) => setOnlyUnread(event.target.checked)}
              disabled={running !== undefined}
            />
          }
          label="Skip posts already read"
        />
        {running === undefined ? (
          <Button
            variant="contained"
            size="small"
            disabled={selectedValue === ''}
            onClick={poll}
            data-testid="poll-start"
          >
            Read everything
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => void stopPoll(selectedValue)}
            data-testid="poll-stop"
          >
            Stop
          </Button>
        )}
      </Stack>
      {running !== undefined ? (
        <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="poll-status">
          {running.boardsTotal > 0
            ? `Board ${Math.min(running.boardsDone + 1, running.boardsTotal)} of ${running.boardsTotal}`
            : 'Starting'}
          {running.doing !== undefined ? ` - ${running.doing}` : ''} - {running.postsRead} posts
          read
        </Typography>
      ) : lastPoll !== undefined ? (
        <Typography
          variant="body2"
          sx={{ mt: 1.5, color: 'text.secondary' }}
          data-testid="poll-outcome"
        >
          {boardPollOutcomeMessage(lastPoll)}
        </Typography>
      ) : null}
    </Paper>
  )
}

interface ArchiveProps {
  boards: BoardSummary[]
  selected: string | null
  board: BoardRecord | null
  exportedTo: string | null
  error: string | null
  onSelect: (key: string) => void
  onRefresh: () => void
  onExport: () => void
}

function Archive({
  boards,
  selected,
  board,
  exportedTo,
  error,
  onSelect,
  onRefresh,
  onExport
}: ArchiveProps): React.JSX.Element {
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
              onClick={() => onSelect(summary.key)}
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
          <Button onClick={onRefresh}>Reload</Button>
        ) : (
          <BoardView board={board} exportedTo={exportedTo} error={error} onExport={onExport} />
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
