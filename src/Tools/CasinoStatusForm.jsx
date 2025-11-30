export function CasinoStatusForm({ roomName, roomId, moneyInRoom, statusInRoom, betSides }) {
    return <div
        style={{
            position: 'fixed',
            top: '10px',
            left: '10px',
            padding: '6px 12px',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: '14px',
            borderRadius: '6px',
            zIndex: 800,
            pointerEvents: 'none',
            userSelect: 'none'
        }}
    >        Room Name: {roomName}
        <br />
        Room ID: {roomId}
        <br />
        User Status: {statusInRoom}
        <br />
        In Room Chip Value: {moneyInRoom}
        <br />
        Bet Sides: {betSides && Object.keys(betSides).length > 0 ? Object.entries(betSides).map(([side, amount]) => `${side}: ${amount}`).join(', ') : 'None'}
    </div>
}