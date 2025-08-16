import { useEffect } from "react";

function importantNotice() {
    const noticeMap = {
        '0101': ['Tim wishes you a happy new year! 新年快乐！', ''],
        '0214': ['Tim wishes you have someone to hug with today! 情人节快乐！', ''],
        '0420': ['Tim wishes you have a nice Easter break! 复活节快乐！', ''],
        '0620': ['Mānawatia a Matariki – kia hari, kia hauora, kia noho tahi ai tātou i raro i ngā whetū. 毛利新年快乐！愿我们在星辰下团聚，拥有幸福与健康！Celebrate Matariki – may we be happy, healthy, and together beneath the stars.', ''],
        '0714': ["Tim's girlfriend Sandra just had her birthday recently! Click here to see the gift that Tim prepared for her", 'https://www.bty.co.nz/hb_to_qxl/index.html'],
        '0825': ['Tim & his girlfriend Sandra just had their anniversary! Click here to see the gift that Tim prepared for her', 'https://www.bty.co.nz/365/index.html'],
        '1225': ['Tim wishes you a marry xmas! 圣诞节快乐！', ''],
    };

    const defaultNotice = ['Welcome to Tim Bi\'s world! 欢迎来到Tim Bi的世界！ Recent notice happened around Tim: ' + noticeMap["0714"][0], 'https://www.bty.co.nz/hb_to_qxl/index.html'];

    const today = new Date();
    let closestNotice = null;
    let minDifference = Infinity; // 用于找出最接近今天的通知

    Object.keys(noticeMap).forEach(key => {
        const month = parseInt(key.substring(0, 2), 10);
        const day = parseInt(key.substring(2, 4), 10);
        const noticeDate = new Date(today.getFullYear(), month - 1, day);
        const difference = Math.abs(noticeDate - today);

        // 检查是否在前后14天的范围内，如果是的话则和当前最小差值进行比较再用更小的来替代
        if (difference <= 14 * 24 * 60 * 60 * 1000) {
            if (difference < minDifference) {
                minDifference = difference;
                closestNotice = {
                    noticeContent: noticeMap[key][0],
                    noticeLink: noticeMap[key][1] === '' ? null : noticeMap[key][1]
                };
            }
        }
    });

    return closestNotice ? closestNotice : { noticeContent: defaultNotice[0], noticeLink: defaultNotice[1] };
}



function Header({ onAnimationEnd, defaultNotice, defaultBaseDuration }) {
    const { noticeContent, noticeLink } = defaultNotice ? defaultNotice : importantNotice();

    // 假设基础是每100个字符10秒
    const baseDuration = defaultBaseDuration ? defaultBaseDuration : 10; // 10秒
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
                zIndex: 10000,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                padding: '10px 0',
                boxShadow: '0 2px 4px rgba(0,0,0,.1)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...(noticeLink && { cursor: 'pointer' })
            }}>
                <div className="container" style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {noticeLink ? <a
                        href={noticeLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}>
                        <h1 style={{
                            display: 'inline-block',
                            animation: styleAnimation,
                            fontSize: '1.5rem',
                        }}>{noticeContent}</h1>
                    </a> :
                        <h1 style={{
                            display: 'inline-block',
                            animation: styleAnimation,
                            fontSize: '1.5rem',
                        }}>{noticeContent}</h1>}
                </div>
            </div>
        </>
    );
}


export default Header;