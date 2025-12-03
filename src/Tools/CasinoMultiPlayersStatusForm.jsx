export function CasinoMultiPlayersStatusForm({ playersData }) {
    if (!playersData || !playersData.users) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: '2.5%',
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
        >
            <div><b>{playersData.countOfUsersInRoom} players in room:</b></div>
            {playersData.users.map(u => (
                <div key={u.userId} style={{ marginTop: 2 }}>
                    {u.userName} - {u.roomUserStatus}
                </div>
            ))}
        </div>
    );
}
