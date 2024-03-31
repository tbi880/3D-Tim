import { useEffect } from "react";

function importantNotice() {
    const noticeMap = {
        '0101': ['Tim wishes you a happy new year! 新年快乐！', 'https://www.bty.co.nz'],
        '0214': ['Tim wishes you have someone to hug with today! 情人节快乐！', 'https://www.bty.co.nz'],
        '0402': ["Tim's friend Jessie is having her 23th birthday! Click here to wish her a happy birthday and have a look of what Tim prepared for her as her birthday gift!", 'https://www.bty.co.nz/jessie'],
        '1225': ['Tim wishes you a marry xmas! 圣诞节快乐！', 'https://www.bty.co.nz'],
    };

    const today = new Date();
    let closestNotice = null;
    let minDifference = Infinity; // 用于找出最接近今天的通知

    Object.keys(noticeMap).forEach(key => {
        const month = parseInt(key.substring(0, 2), 10);
        const day = parseInt(key.substring(2, 4), 10);
        const noticeDate = new Date(today.getFullYear(), month - 1, day);
        const difference = Math.abs(noticeDate - today);

        // 检查是否在前后三天的范围内
        if (difference <= 3 * 24 * 60 * 60 * 1000) {
            if (difference < minDifference) {
                minDifference = difference;
                closestNotice = {
                    noticeContent: noticeMap[key][0],
                    noticeLink: noticeMap[key][1]
                };
            }
        }
    });

    return closestNotice ? closestNotice : { noticeContent: '', noticeLink: '' };
}



function Header({ onAnimationEnd }) {
    const { noticeContent, noticeLink } = importantNotice();

    // 假设基础是每100个字符10秒
    const baseDuration = 10; // 10秒
    const chars = noticeContent.length;
    const duration = Math.max(baseDuration, (chars / 100) * baseDuration); // 确保至少是基础时间，避免内容太少动画太快
    const styleAnimation = `marquee ${duration}s linear`; // 直接使用字符串拼接定义动画

    // 添加CSS动画
    const styles = `
@keyframes marquee {
    from { transform: translateX(50%); }
    to { transform: translateX(-100%); }
}
`;

    // 导航函数
    const navigateToURL = () => {
        window.location.href = noticeLink;
    };

    useEffect(() => {
        const timer = setTimeout(onAnimationEnd, duration * 1000); // 将duration转换为毫秒
        return () => clearTimeout(timer); // 组件卸载时清理计时器
    }, [onAnimationEnd, duration]);


    return (
        <>
            <style>{styles}</style>
            <div style={{
                position: 'fixed',
                top: 0,
                width: '100%',
                height: '10vh',
                zIndex: 2,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                padding: '10px 0',
                boxShadow: '0 2px 4px rgba(0,0,0,.1)',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }} onClick={navigateToURL}>
                <div className="container" style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    <h1 style={{
                        display: 'inline-block',
                        animation: styleAnimation, // 正确设置动画样式
                        fontSize: '1.5rem',
                    }}>{noticeContent}</h1>
                </div>
            </div>
        </>
    );
}


export default Header;