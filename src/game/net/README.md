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
           /            |             \             rooms, who is ready, WebRTC signalling
      device A       device B       device C
      (host)   <---- WebRTC ---->   (joiners connect to the host only)
   MatchServer
   + ClientMatch    ClientMatch     ClientMatch
```

* **The lobby server** (`3D_Tim_backend`, `EchoesLanHub`) finds players a room (the rooms on
  the caller's network, quick match, or a code), keeps the room (names, devices, ships,
  readiness), says who each connection is (account or guest) and relays WebRTC offers /
  answers / candidates. It never sees match traffic. `lobby/LobbyClient.js` is the game's
  end of it.
* **The devices talk to each other directly** over WebRTC data channels
  (`transport/PeerLink.js`): on one Wi-Fi that is a few milliseconds, which a detour through
  a server on the internet could never be. Across the internet it is still direct wherever
  the two networks allow it, and through a relay where they do not. Two channels per link: `state` (unordered, never
  retransmitted - snapshots and inputs, where late is worthless) and `events` (reliable).
* **The host's device runs the one real simulation**: `server/MatchServer.js`, with one
  `World` per zone (`server/Zone.js`). It has no screen and no player of its own.
* **Every device, the host's included, runs a `match/ClientMatch.js`**: a copy of the zone
  its player is in. The host's own client reaches the server through an in-memory link
  (`match/HostSeat.js`), so there is one way of showing a match and the host sees nothing
  the others do not.
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
  first. If there is none it opens one and the player waits in it as host. Nobody readies up
  or presses start: each device reports ready once its link to the host is open, and the
  server starts the match 20 s after two players are in, 5 s once the room is full
  (`LanAutoStartService`). A device that cannot reach a room's host leaves by itself and asks
  for another room (`LanMultiplayer.tryAnotherRoom`); a room whose host leaves before the
  start sends its players looking again.
* **Private** - listed nowhere. For friends anywhere: one opens it and passes the code on.

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

Not there yet: a match does not survive its host leaving, and a public room's host can
cheat like any host (see "Cheating"). Both need the match to run on a server instead; the
`MatchServer` was written so that it can.

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
| snapshot | state | server, 30 / s | every ship's pose, hull, shield; beams; the receiver's own ship in full (`codec/snapshotPacket.js`) |
| hello / action / req / ping | events | client | "send me the world", a pilot action, a request to the game mode (`protocol.js`) |
| welcome / batch | events | server | the whole zone; then what happened each frame: spawns, hits, kills, the match state |

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
host who modifies their game can cheat, as in any LAN game. Closing that needs the server
to run somewhere neutral - `MatchServer` has no browser in it for exactly that reason.

## The host's page in the background

The game advances once per drawn frame, and browsers stop drawing hidden pages.
`lobby/hostHeartbeat.js` keeps a hosted match going from a Web Worker's timer when that
happens. It cannot help when the system suspends the page altogether (a phone whose browser
is put away): the other players then lose the host after `NET.linkTimeout` and are told so.

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
3. Open the game in two tabs (or two devices), *Multiplayer (LAN)*, create a room in one,
   join in the other. "Quick" match length makes the collapse and the jump drive about three
   times as fast.
