# Multiplayer

Multiplayer for Echoes of Dawn: several devices - computers, phones, VR headsets - in one
match, on one Wi-Fi ("LAN") or anywhere on the internet ("global"). This folder is the
machinery (who talks to whom, and what they say); what a match is *about* is a game mode in
`../modes/` (today: the battle royale).

The two kinds differ only in how a room is found (see "Rooms" below). Names in the code say
"Lan" throughout because LAN play came first.

## How a match is wired

```
            lobby server (.NET, SignalR)            only before and between matches:
           /            |             \             rooms, who is ready, WebRTC signalling,
      device A ----- device B ----- device C        and which device hosts
      (host)   \_______ WebRTC _______/             (every device is linked to every other)
   MatchServer
   + ClientMatch    ClientMatch     ClientMatch
```

* **The lobby server** (`3D_Tim_backend`, `EchoesLanHub`) finds players a room (the rooms on
  the caller's network, quick match, or a code), keeps the room (names, devices, ships,
  readiness), says who each connection is (account or guest) and relays WebRTC offers /
  answers / candidates. It never sees match traffic, and a match does not need it: a device
  whose connection to it drops is taken off the room's list, but keeps its links and its
  place in a match being played (`LanMultiplayer.syncLinks`); only back in the lobby does the
  list count again. `lobby/LobbyClient.js` is the game's end of it.
* **The devices talk to each other directly** over WebRTC data channels
  (`transport/PeerLink.js`): on one Wi-Fi that is a few milliseconds, which a detour through
  a server on the internet could never be. Across the internet it is still direct wherever
  the two networks allow it, and through a relay where they do not. Two channels per link: `state` (unordered, never
  retransmitted - snapshots and inputs, where late is worthless) and `events` (reliable).
* **One device, the host, runs the one real simulation**: `server/MatchServer.js`, with one
  `World` per zone (`server/Zone.js`). It has no screen and no player of its own. Which
  device that is, and what happens when it is lost, is "The host" below.
* **Every device, the host's included, runs a `match/ClientMatch.js`**: a copy of the zone
  its player is in. The host's own client reaches the server through an in-memory link
  (`match/HostSeat.js`), so there is one way of showing a match and the host sees nothing
  the others do not.
* A game mode may take a device's picture for itself (`ClientMatch.takeStage`): the world is
  emptied and from then on nothing the host sends about ships and shots is drawn, only the
  match's own word (state, cues) is heard. The battle royale does this for its ending, which
  every device plays at the stargate wherever its player was.
* `lobby/LanMultiplayer.js` is the conductor the menus talk to: lobby, links, starting and
  ending matches on the `GameSession` (`session.beginMatch`). `lobby/lanStore.js` is the only
  file that knows the browser (SignalR, WebRTC, the site's sign-in, the hub's address).

## Rooms: one Wi-Fi, or anywhere

A room is where players gather before a match and between matches. There are three kinds
(`ROOM_VISIBILITY` in `lobby/LanMultiplayer.js`, `LanRoomVisibility` in the backend), and
whatever its kind a room can be joined from anywhere by typing its five-letter code:

* **Network** - listed to the devices that reach the lobby server from the same network (the
  same public address). This is LAN play: open the lobby, see the room, join. The host sets
  the options and presses start.
* **Public** - found by **quick match** from the global lobby. The server picks the best
  room that is gathering players: same match protocol version and mode, a host in the
  player's country if there is one, else on their continent, else anywhere (the backend
  reads the country from the reverse proxy's header, `Lan:CountryHeader`); the fullest room
  first. If there is none it opens one and the player waits in it as host. Players say when
  they are ready, as in any room, but nobody presses start: the server starts the match
  20 s after everybody (two players at least) is ready, 5 s once the room is full
  (`LanAutoStartService`). A device that cannot reach a room's host leaves by itself and asks
  for another room (`LanMultiplayer.tryAnotherRoom`); a room whose host leaves before the
  start sends its players looking again.
* **Private** - listed nowhere. For friends anywhere: one opens it and passes the code on.

In every kind of room the host can put a player out while it is a lobby (`KickPlayer`): one
who will not ready up, say, and is holding up a public room's countdown. They are told, and
are neither let nor matched back into that room.

### Reaching each other across the internet

On one Wi-Fi two devices find each other with their local addresses. Across the internet
they need help, and the lobby server says which (`GetIceServers`, the backend's
`IceServerProvider`, configuration section `Lan:Ice`):

* **STUN** servers tell a device its public address. That is enough for most home networks.
* A **TURN** relay carries the traffic where it is not: strict NATs, some mobile and office
  networks. Without one, those players cannot reach a host outside their own network.
  Configure one of: `Lan:Ice:Cloudflare` (`TurnKeyId`, `ApiToken` - Cloudflare Realtime TURN)
  or `Lan:Ice:Turn` (`Urls`, `SharedSecret` - an own coturn with `use-auth-secret`). Both are
  secrets: environment variables or user secrets, never the repository.

The match still runs on the host's device, so everybody's delay is their distance to the
host - which is why quick match looks for a near one - and other ships are drawn 100 ms
behind the host's word instead of the LAN's 45 (`NET.internetInterpolationDelay`).

A match is given to the best-placed device and survives losing it (see "The host"). What
is not there: a public room's host can cheat like any host (see "Cheating"). That needs the
match to run on a server instead; the `MatchServer` was written so that it can.

### Computer-flown players

A match that starts short of players is made up with bots (`modes/battleRoyale/bots.js`,
`BATTLE_ROYALE.bots`; a room's `bots: 'none'` setting leaves the seats empty). A bot has a
pilot's seat on the match server like a person's (`MatchServer.addBot`): the same ships, the
same flight model and weapons, the same rules, a side dealt with everybody's. The only
difference is where its controls come from - a small program on the host's device writes
them every frame instead of a packet from a player's device - so the other devices carry
nothing extra but one more ship in their snapshots.

## What travels

| | Channel | From | Content |
| --- | --- | --- | --- |
| input | state | client, every frame | 11 bytes: stick, throttle, buttons (`codec/inputPacket.js`) |
| snapshot | state | server, 30 / s | every ship's pose, hull, shield, flags (boosting, cloaked, shield held down ...); beams; the receiver's own ship in full, with where its ability stands (`codec/snapshotPacket.js`) |
| hello / action / req / ping | events | client | "send me the world", a pilot action, a request to the game mode (`protocol.js`) |
| welcome / batch | events | server | the whole zone; then what happened each frame: spawns, hits, kills, abilities starting, ending and going off, the match state |

Remote ships are drawn a moment (45 ms) behind the newest snapshot, blended between two
(`match/SnapshotTimeline.js`). The player's own ship does not wait: it is flown at once with
the same flight model the server uses and corrected when the server's answer arrives
(`match/ShipPredictor.js`). Tuning: `netConfig.js`.

## Cheating

A client can only send **controls and requests**. It never reports a position, damage, a
kill or a score, so there is nothing of that kind to forge:

* the stick is stored as signed bytes: it cannot leave -1..1 whatever is sent;
* every packet from a client passes `ClientGuard.js`: exact size and type, sequence numbers,
  a rate budget; reliable messages must be one of four kinds with fields of the right type.
  Rubbish is dropped and counted, and a client that keeps sending it is disconnected;
* requests to the game mode carry no "who": the server knows which link they came in on.
  The mode checks every field (jump only to a neighbouring planet, with a charged drive...);
* who a link belongs to is the lobby server's word (it stamps the sender on every relayed
  signal), and a link from someone not in the match is refused;
* what a client receives is checked too (`sanitize...`), so a broken host cannot crash it.

What this does **not** cover: the host. The simulation runs on the host's own device, so a
host who modifies their game can cheat, as in any LAN game - and a device can make itself
host by reporting itself faster and nearer than it is. Closing that needs the server to run
somewhere neutral - `MatchServer` has no browser in it for exactly that reason.

## The host

One device runs the match for everybody. It is not whoever owns the room: the room's owner
sets the options, starts it and can put players out, and that is all.

**Choosing it.** In the lobby every device links to every other (the one that joined later
calls), pings each link every couple of seconds, and times a small standard simulation once
(`lobby/hostFitness.js`). It reports both to the lobby server (`ReportFitness`). When the
match starts the server ranks the players (`LanRoomManager.RankHosts`): devices linked to
everybody first, then the lower "average round trip + 40 x milliseconds per simulation
step". The best one hosts; the whole ranking comes with the match as the order of
succession. With nothing reported the owner hosts, as it used to.

**Keeping a way on.** While it hosts, a device keeps ranking the others the same way from
what they report to it (`MSG.LINKS`, with every ping) and every three seconds
(`NET.checkpointInterval`):

* tells every device the order of succession and its own term (`MSG.SUCCESSION`; the term
  is 0 for the first host and one more for every takeover);
* sends the first two in line a **checkpoint** (`MSG.CHECKPOINT`, in pieces): the whole
  match as plain data - `MatchServer.capture()`: every zone's ships (`server/checkpoint.js`)
  and the game mode's own state (`saveState`).

**Losing it.** A client that hears nothing from its host for `NET.hostLostTimeout` (or
whose link to it closes) stands still and asks its controller (`LanMultiplayer.onHostLost`),
which walks the order of succession. Across the internet the wait is
`NET.internetHostLostTimeout`, and for the host's very first word `NET.firstContactTimeout`
(it may still be setting the match up). Only time this device itself was running counts:
a page that was not drawn for a while does not hold that against its host, and what arrived
meanwhile counts from when it arrived. Guessing wrong is dear - the match goes back to a
checkpoint, or ends for a device that has none - and the start of a match, when every device
is busy with a new scene, is where it was easiest to guess wrong.

* the first device in it that this one is still linked to becomes its host: the client is
  given that link (`ClientMatch.switchLink`) and asks it for the world until it answers;
* if the first one is this device itself, it takes over (`takeOver`): a new `MatchServer`
  from its last checkpoint (`MatchServer`'s `checkpoint`; the mode's `restoreState`), every
  link it has attached to it, and a notice to everybody (`MSG.TAKEOVER` with the new term);
* a device that does not answer within `NET.takeoverTimeout` is passed over.

The match goes on from the checkpoint - a few seconds back - without the player whose
device was lost, and without shots that were in flight. A device that hears of a takeover
with a later term than it knows follows it at once; if it was hosting itself (it had only
stalled, or was cut off from the others) it stands down and plays on as a client. If two
devices take over in the same term (each noticed before hearing of the other), the one
whose player id sorts first is the host - the same choice on every device.

What this does not do on one Wi-Fi: two groups of devices that can no longer reach each
other at all each go on with their own match (across the internet the lobby server settles
that: see the next section); and a device that never got a checkpoint (it was third in
line or further, and both ahead of it are gone as well) cannot take over - the match ends
for those it would have served, as it used to for everybody.

The checkpoint holds everything, including what the map hides from a player. The two
devices next in line could read it. That is the price of not running the match on a server.

### The server as referee (across the internet)

Across the internet a device cannot tell a host that is gone from a link to it that broke,
and guessing differently on two devices made two matches - in each of which the other side
had left, so this side won on the spot. There the lobby server rules who runs the match:

* **The host's sign of life.** Every `NET.serverSnapshotInterval` (1 s) the host sends the
  server a snapshot of the whole match - `MatchServer.capture()`, gzip, base64
  (`lobby/matchSnapshot.js`): about 3 kB of 35 kB - with its line of succession
  (`PutMatchSnapshot`). The server keeps the last one of the current host, in the current
  term, and nothing from anybody else.
* **A lost host is reported, not guessed at.** A client that hears nothing for
  `NET.internetHostLostTimeout` (or whose link closes) asks the server (`ReportHostLost`). If
  the host sent within the last 4 seconds only this client's link to it is broken: the client
  makes it again (any device may call during a match; of two calls at once the one who joined
  later wins) and the match goes on with nobody taking over. If the host is silent - or most
  players have lost it - the server gives the match to the next in the host's line who is
  still connected, in a new term, and tells the room (`MatchHostChanged`) with its snapshot.
  That device goes on from the snapshot or its own checkpoint, whichever is newer; everybody
  else turns to it at once. The server decides under the room's lock: one host per term.
* **The old host stands down.** A host that was replaced (it had stalled, or was cut off)
  hears it in the answer to its next snapshot, or when it gets back to the lobby: it throws
  its copy of the match away and joins the new host as a client, in its own ship. The match
  is not handed back: that would cost a second rollback and a second pause for nothing.
* **Nobody is out for a broken link.** Across the internet `MatchServer` keeps a player whose
  link closed away for `NET.rejoinGrace` (45 s): their ship flies on with nobody at the helm,
  and their device's new link puts them back in it. On one Wi-Fi they are out at once, as before.
* **Nor for a dropped lobby connection.** During a match the server keeps the place of a
  player whose connection dropped for 60 seconds (shown as not connected); the device
  reconnects (`NET.lobbyRetryDelays`) and takes it back with the resume token its last
  connection was given (`LobbyClient.resume`, the hub's `ResumeSession`): the same player id,
  so the others can link to it again and the server can be asked.

A device that cannot reach the server falls back on the devices' own succession above. The
server never reads a snapshot; the devices check it like any checkpoint.

### The host's page in the background

The game advances once per drawn frame, and browsers stop drawing hidden pages.
`lobby/hostHeartbeat.js` keeps a hosted match going from a Web Worker's timer when that
happens. It cannot help when the system suspends the page altogether (a phone whose browser
is put away): the others then lose the host, and the next in line takes over.

## Adding a game mode

See `../modes/index.js`: a mode is a *rules* class (runs in the server) and a *presenter*
(runs beside every client). The lobby server needs no change: a room's options are a mode
id plus a small map of settings it passes through untouched.

## Tests

```
npm run game:test
```

`tests/game/`: the codecs, the guard, whole matches over in-memory links (`support/
matchHarness.js`), a modified client against the server (`hostSecurity.test.js`), the battle
royale's rules, the lobby flow against stand-ins for the lobby server and WebRTC, and
`PeerLink` against a fake WebRTC. The backend's rules are tested there (`UnitTests/Lan`).

## Trying it on one machine

1. Start the backend (`dotnet run` in `3D_Tim_backend/Main`; it listens on 5133).
2. `npm run dev`, with `stageOfENV = "dev"`: the dev server passes `/connect/echoes-lan` on
   to the backend, so phones and headsets on the Wi-Fi can use `https://<this-machine>:5173`.
3. Open the game in two tabs (or two devices), *Multiplayer* on the title menu and then
   *LAN*, create a room in one, join in the other. "Quick" match length makes the collapse
   and the jump drive about three times as fast.
