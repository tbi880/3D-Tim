export function CasinoMultiPlayersStatusForm({ playersData }) {
    if (!playersData || !playersData.users) return null;

    const statusMapToDisplay = {
        'betting': 'still betting',
        'dealing': 'opening cards',
        'results': 'waiting for results',
        'waiting': 'waiting for next round'
    };

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
            <div><b>{playersData.countOfUsersInRoom} {playersData.countOfUsersInRoom === 1 ? 'player' : 'players'} in room:</b></div>
            {playersData.users.map(u => (
                <div key={u.userId} style={{ marginTop: 2 }}>
                    {u.userName} - {statusMapToDisplay[u.roomUserStatus]}
                </div>
            ))}
        </div>
    );
}
