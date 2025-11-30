
const suitMap = {
    '♣': 'clubs',
    '♦': 'diamonds',
    '♥': 'hearts',
    '♠': 'spades',
};

const rankMap = {
    'A': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    'J': 11,
    'Q': 12,
    'K': 13,
};

export function cardStringToModelUrl(cardString) {
    if (!cardString || cardString.length < 2) return 'casino/cards/spades_1.glb';
    const suitChar = cardString[0];
    const rankPart = cardString.substring(1);

    const suit = suitMap[suitChar];
    const rankIndex = rankMap[rankPart];
    if (!suit || !rankIndex) {
        console.error('Unknown cardString', cardString);
        return null;
    }
    return `casino/cards/${suit}_${rankIndex}.glb`;
}
