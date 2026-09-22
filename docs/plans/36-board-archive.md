# WP36 — the board archive: bulletin boards and mail off the wire

**Size:** L. **Depends on:** WP11 (the store), WP13 (the action layer), WP17 (the pane watcher and
the click gestures), WP34 (the popup rule). Read `00-overview.md` first. **IN PROGRESS.** **Card:**
`HTOO-395`.

**PR1, the passive half, built 2026-09-22.** `decode/board.ts` reads every `0x31` type and every
`0x3B` action; `model/board.ts` keeps what the client shows per connection (the list, the open
index with every page seen and what the newest page added, the post on screen, the newest
request); `store/boardStore.ts` is `boards.json`, with a header never replacing a body and the
mailbox keyed `mail:<name>`; the capture service attributes a post to the board the client's read
asked for and queues the archive's writes with the characters'; the **Boards** tab lists the
archive and exports a board in the prototype's shape.

**The live browse of 2026-09-22 03:31Z proved the decoders** — Sabrael read Mileth Political
Discourse (board 188) on retail: 80 headers over five pages and seven bodies, no `0x31` or `0x3B`
unreadable. What it settled, beyond the plan:

- **The post's `u16` is the post id.** `readPost 80` was answered with `postId 80`; the document
  repo was right and darkages-741-re's `board_id` is wrong.
- **Retail lists the mailbox as board 0 "Mail"** in the board list (heading empty), so a board
  list does put a "Mail" entry on the wire; the archive leaves it out, since the mailbox is per
  character.
- **The client's page cursor is the oldest held id minus one**, so retail's pages do not overlap
  (80–65, then 64–49, 48–33 …): the prototype's "inclusive" overlap was its own cursor. Sixteen
  rows a page. The dedupe stays, and costs nothing.
- **The client's repeat trap is real.** One scroll at the bottom sent the same `listPosts 32,-16`
  91 times in 100 ms and the server answered every one. The poll drives that client, so it must
  count a page by what it adds (the reducer's `lastPageAdded`) and never by the number of replies,
  and it must wait for one reply before it scrolls again.
- **Next is `navOffset −1`** (79 after 80) **and Prev is `+1`**, and the reply carries the post's
  real id. Not used by the poll (decision 4), but known.
- **A body's line breaks are `\r`, `\r\n`, and `\n`**, as each player typed them; the tab shows
  them as breaks and the export keeps them as sent.
- A post arrives with `subType 3` and an index with `subType 2` when opened from the board list;
  the plan's "0 normal" is Hybrasyl's value.

The second browse the same night (Angelique, 04:10Z to 04:16Z: Rucesion Political Discourse and
Demagoguery, the Rangers board; 352 requests and 355 replies, none unreadable) added these:

- **A board in the world opens with no `0x3B`.** A board object on a map (the Rucesion Hall
  boards, the Cura board at Vaillaire) is clicked as an object, `CClick 0x43`, and the server
  pushes the first page (`subType 2`) as the reply to that click. Only the pages after it are
  `listPosts`. The passive archive needs nothing for this, since a page is stored whichever
  request brought it, and the poll reads every board through the board list, where each has a row.
- **The client fetches a second page on its own** as soon as a full first page arrives: `32767`,
  the reply, then `oldest − 1` within 2 ms, every time a board opens. A board of 16 posts or
  fewer needs one page and gets one request. The poll counts pages by what they add, so the
  client's own second page costs it nothing.
- **The repeat trap again, worse:** one scroll at the bottom of the Rangers board sent the same
  `listPosts 271,-16` **190 times in 130 ms**, and the server answered all 190.
- **The client's own post decodes.** Angelique's "Jailed - Micus - Botting" went out as action
  `post` with the subject and the body as typed, and the reply was type 6 "Your letter was sent."
  The poll never sends this, and the decoder now has a live sample.
- Prev is `+1` again (269 after 268), read from the post pane. The id in a Prev or Next request
  is the shown id plus or minus one, and the server answers with the nearest post that exists:
  `read 74 by -1` on a board with no 74 came back as 71.

**The measuring browse (Evenue at the Vaillaire Cura board, 04:33Z to 04:42Z, through the pane
watcher's board side)** gave the poll its positions and its gestures:

- **The pane sits at x 30, y 0** in the game's 640 x 480 space: a 581-wide pane centred across the
  width and flush with the top. Every measured button fits that offset and no other: View at game
  (562, 51) sent a read, Next at (562, 96) and (573, 95), Prev at (570, 69), Up at (573, 228)
  went back to the list with no packet, Close at (555, 259) and (562, 258).
- **Rows are 18 px from pane y 18, and 14 are visible.** The top row's centre is game y 27
  (a click at (319, 29) then View read the newest post); a click at y 208 after a scroll to the
  bottom of a 72-row list opened the 69th newest post, which is row 10 of the last 14.
- **A single click on a row selects it, and View opens it.** A double click on a row opens it
  too (the hand browse did that on the board list), which the poll does not rely on: `click` is
  posted once for a row, and the client's request after the row click, when the double landed
  anyway, is what tells the poll to skip View.
- **The scrollbar's arrows move the list a row a click, and the down arrow at the bottom asks
  for the next page.** The scrollbar sits at game x 529 to 532, its up arrow at y 26 and its down
  arrow at y 265; fifteen hand clicks on each were logged, and the clicks at the bottom sent
  `listPosts 24`. The arrow keys and the mouse wheel do the same by hand (Sabrael's key run sent
  `listPosts 56` and `40` with no click at all), **but a posted Down moved no selection** on the
  second live run (05:10Z: the poll clicked View after each press and the client read the same
  post, row 0, four times), as a posted `W` opened nothing and a posted digit chose nothing on a
  dialog (WP17). So the poll is clicks only: it keeps a picture of the list (which row is at the
  top of the fourteen on screen, and how many rows a click moves), clicks a row it can see, and
  the post id the server answers with is the check on the picture. A wrong reply corrects it and
  teaches it: that Up from a post puts the list back at the top, or that a click moves more rows
  than one; each is learned from one miss and holds for the board.
- **Up from a post goes back to the list with no packet; Up from a list sends `listBoards`.**
- **The mail panes differ from the board panes in two buttons.** The mail list's View is at pane
  y 61 to 83 (the board list's is 35 to 57), and the mail list has Quit at 218 to 240 and Up at
  245 to 267, the reverse of the post list's Up (218 to 240) and Close (245 to 267). A poll that
  clicked the board list's Up on the mailbox would close the whole pane.

**PR2, the poll, built 2026-09-22** from the measuring browse: `boardPoll.ts` is the driver
(the board button, a visible row, the scrollbar's arrows, View, Up, Quit; every gesture waits
for its packet, and the post id in every reply checks the poll's picture of the list),
`handlers/boards.ts` gains `boards:poll`, `boards:poll-stop`, and `boards:poll-state`, and the
Boards tab has the window picker, **Read everything**, **Read the open board** (the list on
screen now, which is how a board in the world is read, since a click on a board object opens it
with no board list), **Read in the game** on each board of the archive, the "skip posts already
read" box, and the line that says what the poll is on. Proven against a retail-shaped fake
client through the real reducer (`__tests__/boardPoll.test.ts`), with the two quirks a live run
could show (Up back to the top; more rows a click) each learned from one miss.
**A post id is not unique over a board's life** (Sabrael, 2026-09-22, with the poll working):
a post that leaves the board frees its id for the next one, so the archive never overwrites a
post under its id. A listed id whose author, date, or subject differ from the post held is a
new post; the old one moves to `${id}~${seenAtMs}` with `displacedAtMs`, the tab shows it after
the post that took the id ("gone from the board; its id was reused"), the export marks it
`displaced`, and the poll's "already read" check counts only the post the board shows now.
**First live run, 05:06Z: a posted `W` with its character opened nothing** (five tries, the
same key a hand press opens the list with), so the opener is the client's own board button,
measured at game (626, 248) from two hand clicks the watcher paired with `listBoards`. **Second
run, 05:10Z: a posted Down moved no selection**, so the keys are out and every gesture is a
click. The profile click for the legend is not in it: the profile button's place is not
measured.

**Trigger:** Sabrael, 2026-09-21: retail's boards hold years of player-written content that exists
nowhere else, and no tool in the house reads them. The Brigid prototype (`feat/board-capture-debug`,
`BoardCaptureSession.cs`, 2026-07-17; recovered from a dangling commit on 2026-09-21) proved the
sweep against retail, and its UI half was deleted by Brigid #48. Both halves are wanted: a passive
record of everything the player reads, and a **poll the player starts from a tab of its own** that
reads every board and every mail end to end. **Mail is in scope**: many boards are reached through
the mail screen, and the mailbox is the player's own.

## Goal

Keep every board post and every mail the player sees, from the wire, in a store of its own, and
export a board or a mailbox as JSON. Then let the player press one button and have Midir read a
whole board — every page of the list, every body — through the client's own input queue, with the
same rules every driving feature has: off until asked, one stop that always works, no packet sent.

The same poll reads the profile, so the legend is on the record without the player opening it
(`SSelfLook 0x39` arrives only when the profile is opened; #25 keeps it once read).

## What the wire carries (both protocol sources, read together)

Two opcodes carry everything. The document repo's pages are binary-verified against the USDA
client; darkages-741-re's `network/server/049-0x31-bulletin.md` and
`systems/bulletin-and-mail.md` add the client's own behaviour.

**`SBulletin 0x31`** (S→C, MD5Key). The first body byte is the type, and the type selects both the
wire shape and the dialog it opens, so it travels as its own field:

| Type | Dialog            | Shape                                                                                                               |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | BoardListDialog   | `string8 heading`, `u8 count`, then `count` × `[u16 boardId][string8 name]`                                         |
| 2    | ArticleListDialog | `u8 subType`, `u16 boardId`, `string8 boardName`, `u8 count`, then rows                                             |
| 3    | ArticleDialog     | `u8 subType`, `u8 unused`, `u16 postId`, `string8 author`, `u8 month`, `u8 day`, `string8 subject`, `string16 body` |
| 4    | MailListDialog    | as type 2                                                                                                           |
| 5    | MailDialog        | as type 3                                                                                                           |
| 6–8  | (result alerts)   | `u8 success`, `string8 message` — post, delete, highlight results                                                   |

A list row is `[u8 highlight][u16 postId][string8 author][u8 month][u8 day][string8 subject]`. Rows
come newest first. **The two sources disagree on the `u16` after type 3's two lead bytes:** the
document repo calls it `postId` (a canary: 0 means "no article" and the client pops an alert),
darkages-741-re calls it `board_id`. The document repo is binary-verified and is followed; the
first live capture settles it by comparing the value with the row clicked.

**`CBulletin 0x3B`** (C→S, MD5Key). Action 1 lists the boards (sent when the mailbox opens on the
`W` key, and when a board in the world is clicked). Action 2 `[u16 boardId][u16 startPostId]
[s8 navOffset]` lists a page: the client's first page is `0x7FFF, -16`, and its older-page request
is `(oldest loaded id − 1), -16`. Action 3 `[u16 boardId][u16 postId][s8 navOffset]` reads one post:
`0` for the row clicked, `-1`/`+1` for the Prev and Next buttons (server-side sibling navigation,
which the poll does not use; see decision 4). Board 0 is the mailbox. Actions 4–7 write (post, delete, send mail, highlight) and
Midir never sends them; they are decoded for the record so the player's own posts are on it.

**No recording on disk holds a `0x31`.** The 26 recordings' `0x3B` packets are all the server's
3-byte heartbeat, which shares the number in the other direction. The decoders are written from
the pages and proven by the first live browse, as every decoder before them was.

## What the Brigid prototype measured against retail, and what it did

Four facts carry over: the page is 16 posts; a paged reply includes the cursor post, so pages
overlap by one and a dedupe by id absorbs it; a page that adds nothing new means the oldest post
is reached (there is no count and no end marker); a post deleted between paging and reading
answers as a result, not a post. The code does not carry over: it **sent** `ViewBoard` and
`ViewPost` itself, which Midir cannot do (WP18's proxy is the only way to send, and HTOO-395 says
plainly that a board archive is not worth pulling it forward). Midir's poll drives the client's
own dialogs instead, and the client sends.

darkages-741-re adds the client's own trap: its older-page request fires on every consumed
pointer event at the bottom of the list, with no in-flight flag, no end-of-list flag, and no
repeated-cursor check, so an empty or exhausted list re-requests the same cursor for ever. The poll
must not copy that: one request in flight, wait for the matching reply, stop when a page adds no
new id.

## The one way to get this wrong

**Answering, sending, or deleting.** Every dialog in the board UI has buttons that write: New,
Reply, Delete, Hilight. A driven poll clicks rows, the list's scroll, and two buttons (View, Up)
and nothing else, and the pane positions it clicks are measured, not guessed, by the pane watcher
from a hand click paired with the client's own `0x3B` — the WP17 method. A poll that finds a
dialog it does not expect (a compose pane, a result alert, anything not types 1–5) stops, as the
Laborer does. Delete is a `0x3B` action 5 with a post id, and there is no confirm: one wrong click
is a post gone for everyone. So the poll never clicks below the View button's row on a list, and
never right of the Content pane on a post.

## Decisions

1. **Two decoders, one reducer, one store.** `decode/board.ts` decodes `0x31` (all eight types) and
   `0x3B` (all seven actions). `model/board.ts` is a pure reducer over both: what the board list is,
   which board is open, which page and post are on screen, and the player's own request in flight
   (the client's `startPostId` and `navOffset` are on the record as the real paging behaviour, which
   is independently valuable). `store/boardStore.ts` is a crash-safe JSON file beside
   `characters.json`, `boards.json`: boards by id, each with its name and its posts by post id
   (`author`, `month`, `day`, `subject`, `highlighted`, `body?`, `seenAtMs`, `seenBy`); the mailbox
   is a board per character (`mail:<name>`), because board 0 is whoever is logged in. A post's body
   is filled when its type-3 arrives; a header without a body is a post the player has not opened.
   The schema names every field (WP11's rule), and a body seen once is never replaced by a header.
2. **Passive first, and complete.** The reducer runs on every connection from day one, so a player
   who browses by hand fills the archive with no button pressed. This is the half that cannot break
   the charter and is useful the day it lands. It ships before the poll, as its own PR.
3. **The poll is a driving assistant on a tab of its own, "Boards".** The tab lists the boards the
   archive knows with post counts and read counts, an export button per board (JSON, the shape the
   prototype wrote: `boardId`, `boardName`, `capturedUtc`, `posts[]`), and one button: **Read
   everything**. The poll then, on the selected window: opens the board list (the client's board
   button; a posted `W` opened nothing live), which lists the
   boards; for each board in the list, clicks its row and View, reads the list page off the wire,
   pages older by scrolling to the bottom until a page adds no new id, then opens every post the
   list holds from its own row (row and View, newest first; a post already in the archive with a
   body is skipped when the poll is asked to fill gaps only); then Up, and the next board. The mailbox is a board like any other. Every gesture waits for its packet
   before the next, and a gesture the wire does not answer within its wait stops the poll with the
   reason named, never a loop. The poll reads the profile too: it clicks the profile button once at
   the start, so the legend is read (#25 keeps it).
4. **The list walks the bodies, as Brigid does.** Brigid's boards went through extensive trouble
   and now handle retail correctly, and the poll does what its `PostListPane` and `WorldScreen`
   wiring do, not something of its own: page the list with the cursor at the oldest held id (the
   reply includes the cursor post, so dedupe by id absorbs the overlap), a first page shorter than
   16 rows ends paging at once, a later page that adds no new id ends it, one page request in
   flight per board and never another until its reply lands (the client's own list re-requests
   the same cursor for ever on an exhausted or empty board, and the poll must not let it); then
   open every post by its own id from its row (`0x3B` action 3 with `navOffset 0`), newest first,
   deduped against the bodies held. Prev and Next are never used for the walk: Brigid steps by
   id ±1 itself rather than trust them, and a poll that leaned on them would depend on the
   server's sibling rule and would have no proof it saw every post. The list is the proof: a
   post in the list with no body after the walk is logged as one the walk missed, and the poll
   opens it again once before it moves on. The list dialog shows a page of rows at a time, and
   the poll never clicks a row it cannot see: it scrolls with the scrollbar's arrows until the
   row is among the fourteen on screen (the down arrow at the bottom is what asks the client for
   the next page), clicks the row, and clicks View. Which row is at the top is a picture the poll
   keeps; the post id in every reply is the check on it, and a reply that names another post
   corrects the picture from the list, learns what was wrong (Up put the list back at the top; a
   click moves more rows than one), and tries again, at most `MAX_MISSES` times per board before
   the poll stops as lost. No key is posted: the client answered none on the live runs.
5. **The pane positions are measured before they are used.** The layouts (`_nbdlist.txt`,
   `_narlist.txt`, `_narti.txt`, `_nmaill.txt`, `_nmailr.txt` in `setoa.dat`) give a 581 × 290 pane
   with View at 507–568 × 35–57 (board list), the list rows in 19–499 × 18–273, Prev/Next at
   507–568 × 61–83 / 87–109 on a post, and Up and Quit at the bottom; they do not give the pane's
   place on screen, which the exchange window taught (WP34). The pane watcher gains a board side:
   while a board dialog is up, a hand click is logged and paired with the `0x3B` the client sends,
   which measures the row pitch and each button. Nothing is clicked by the poll until the log holds
   the pair.
6. **Off, and stoppable.** The poll ships off like every driver, runs through the action layer
   (the global stop, the focus-loss stop, the window watch), and stops on a dialog it did not
   expect, on the credential pane (never touched), and on a popup the WP34 rule cannot clear. It
   never clicks New, Reply, Delete, or Hilight, by construction: the click helper takes a button
   name from a closed set of four.
7. **Mail is in.** The mailbox is read like a board and stored per character. Nothing is exported
   unless the player presses the button for that mailbox, and the export names the character.

## Non-goals (stop-lines)

- **No packet sent.** The poll drives dialogs; the client sends. HTOO-68 (WP18) is not pulled
  forward for this.
- **No write to a board.** No post, no reply, no delete, no highlight, ever, by the poll.
- **No search.** The list's Search button opens a text field; the poll does not use it.
- **No reading of another player's profile** (`0x34`); the legend read is the character's own.

## Current state when you start

- `protocol/opcodes.ts` has no entry for `0x31` or client `0x3B`; the frame, cipher, and reader
  layers need nothing. `decode/world.ts` (WP35) is the newest decoder to copy the shape of.
- `model/exchange.ts` and `model/fieldMap.ts` are the small per-connection reducers to copy;
  `captureService` wires each with `xFor(connectionId)`.
- `store/characterStore.ts` is the crash-safe JSON pattern, with `mergeCharacter` as the merge rule
  and the schema as the law of what survives a restart.
- `laborer.ts` is the driving assistant to copy: `waitForDialog`, `chooseRow`, the stop reasons,
  the tab with a window picker and a status line. `paneWatcher.ts` is where the measuring goes.
- `actionLayer.pressKey` posts a key with its scan code and, for Escape, its character; `click`
  posts a left click in game coordinates, once when asked.

## Contracts

```ts
// decode/board.ts
type Bulletin =
  | { kind: 'boardList'; heading: string; boards: { id: number; name: string }[] }
  | { kind: 'postList'; mail: boolean; subType: number; boardId: number; boardName: string; rows: PostHeader[] }
  | { kind: 'post'; mail: boolean; subType: number; postId: number; author: string; month: number; day: number; subject: string; body: string }
  | { kind: 'boardResult'; type: 6 | 7 | 8; success: boolean; message: string }
type BulletinRequest =
  | { kind: 'bulletinRequest'; action: 'listBoards' }
  | { kind: 'bulletinRequest'; action: 'listPosts'; boardId: number; startPostId: number; navOffset: number }
  | { kind: 'bulletinRequest'; action: 'readPost'; boardId: number; postId: number; navOffset: number }
  | { kind: 'bulletinRequest'; action: 'post' | 'delete' | 'sendMail' | 'highlight'; boardId: number; … }

// store/boardStore.ts
interface BoardFile { boards: Record<string, BoardRecord> }   // key: `${boardId}` or `mail:${name}`
interface BoardRecord { id: number; name: string; posts: Record<number, PostRecord> }
interface PostRecord { author: string; month: number; day: number; subject: string; highlighted: boolean; body?: string; seenAtMs: number; seenBy: string }

// boardPoll.ts
interface BoardPoll { run(request: BoardPollRequest): Promise<BoardPollOutcome>; stop(connectionId: string): void; states(): BoardPollState[] }
interface BoardPollRequest { connectionId: string; onlyUnread: boolean }
```

`window.api.boards`: `list()`, `get(boardKey)`, `exportJson(boardKey)`, `poll(request)`,
`stopPoll(connectionId)`, `pollState()`, `onPollState(handler)`, and `onChanged(handler)` for
a changed board.

## Acceptance criteria

1. Every `0x31` type and every `0x3B` action decodes against wire bytes from the first live browse,
   and a body longer than its fields is accepted.
2. A hand browse of one board fills `boards.json` with every header seen and every body opened,
   and a restart shows the same. A header never replaces a body.
3. The mailbox is stored under the character's key and never under another character's.
4. The poll reads a whole board with no key pressed, and no button clicked but the board
   button, a visible row, the scrollbar's arrows, View, Up, and Quit; the log states every
   click's game position and the `0x3B` that followed it; every post the list holds has a body
   at the end, or is named in the log as one the walk missed.
5. The poll stops on a compose dialog, a result alert, the credential pane, and a stop; it never
   sends `0x3B` action 4, 5, 6, or 7 (asserted in the tests and grep-able in the log).
6. The export is the prototype's shape, and a board of 200 posts exports in one file.
7. The poll's profile read puts the legend on the record.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit: the decoders (fixtures from the live browse), the reducer, the store's merge and
   round-trip, and the poll against a fake window whose dialogs answer from a scripted board.
3. **Live, in order (hand to Sabrael):** with Midir up before login, open the mailbox and browse
   one board by hand; read the log's pairs (hand click → `0x3B`) and the Boards tab; then run Read
   everything on one small board; then on the mailbox; then on the largest board there is.
