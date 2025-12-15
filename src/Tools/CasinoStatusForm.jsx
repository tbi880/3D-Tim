export function CasinoStatusForm({ roomName, roomId, moneyInRoom }) {
    return <div
        style={{
            position: 'fixed',
            bottom: '2.5%',
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
        In Room Chip Value: {moneyInRoom}
    </div>
}