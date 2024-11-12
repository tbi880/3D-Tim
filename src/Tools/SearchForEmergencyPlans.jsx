import { useContext, useState, useEffect, useRef } from 'react';
import Typed from 'typed.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';

import { scene5Sheet } from '../pages/SceneManager';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import '../Tools/css/general.css';
import { searchForEmergencyPlansContext } from '../sharedContexts/SearchForEmergencyPlansProvider';

function SearchForEmergencyPlans({ isPortraitPhoneScreen }) {
    const [isOutputDone, setIsOutputDone] = useState(false);
    const { showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer } = useContext(searchForEmergencyPlansContext);
    const { messageApi } = useContext(GlobalNotificationContext);

    const handleAfterPlay = () => {
        setShowSearchForEmergencyPlansLayer(false);
        if (window.location.pathname.includes('/ship_captains_chamber')) {
            scene5Sheet.sequence.play({ range: [165, 186] });
        }
    };

    const containerStyle = {
        color: '#fff',
        padding: '5%',
        position: 'fixed',
        top: isPortraitPhoneScreen ? 0 : '15%',
        left: 0,
        width: '100%',
        height: isPortraitPhoneScreen ? '100%' : '70%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.7)',
        zIndex: 888,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
    };

    const outputContainerRef = useRef(null); // 用于滚动输出区域
    const mainContainerRef = useRef(null); // 用于滚动整个容器
    const outputRef = useRef(null); // 用于存储已完成的输出
    const typingRef = useRef(null); // 用于当前正在输入的文本
    const typedRef = useRef(null);

    useEffect(() => {
        messageApi('warning',
            'Sensitive data is being accessed at command room!',
            2,);
        typedRef.current = new Typed(typingRef.current, {
            strings: [
                "Accessing Captain’s Database...",
                "Initiating multi-layer encryption decryption...",
                "Data retrieved...",
                "Initiating search protocol: Query parameters—‘Emergency Protocols’ and ‘Contingency Plans’.",
                "Decrypting classified folders… Folder 1: ‘Omega Contingencies’… Accessing subfolder: ‘Emergency Maneuvers’.",
                "Analyzing document headers… Keywords: ‘Catastrophic Event’, ‘System Override’, ‘Last Resort’.",
                "Access granted. Loading document ‘Project Dawn’—Status: Inactive.",
                "Identifying sub-protocols within ‘Project Dawn’...",
                "Access complete. Emergency plan loaded: ‘Protocol: Dawn Ascendant’"
            ],
            typeSpeed: 10,
            loop: false,
            showCursor: false,
            onStringTyped: (index) => {
                // 获取当前已完成的文本
                const currentText = typingRef.current.innerText;

                // 创建一个新的 <p> 标签并将其内容设置为当前文本
                const paragraph = document.createElement("p");
                paragraph.textContent = currentText;

                // 将新的段落添加到输出区域
                outputRef.current.appendChild(paragraph);

                // 清空 typingRef，准备下一行
                typingRef.current.innerHTML = "";

                // 滚动输出区域到底部
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTo({
                        top: outputContainerRef.current.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            },
            onComplete: () => {
                setIsOutputDone(true); // 全部完成后显示按钮

                // 最后一次滚动输出区域到底部
                if (outputContainerRef.current) {
                    outputContainerRef.current.scrollTo({
                        top: outputContainerRef.current.scrollHeight,
                        behavior: 'smooth'
                    });
                }
                if (mainContainerRef.current) {
                    mainContainerRef.current.scrollTo({
                        top: mainContainerRef.current.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            }
        });

        return () => {
            typedRef.current.destroy();
        };
    }, []);

    return (
        <>
            <div style={containerStyle} ref={mainContainerRef}>
                <div className="form">
                    <h1 className="title">Searching for Emergency plans</h1>

                    <div className="divider"></div>
                    <div
                        ref={outputContainerRef}
                        style={{ overflowY: 'auto', maxHeight: '60%', width: '100%' }}
                    >
                        <div ref={outputRef}></div> {/* 已完成的输出 */}
                        <div ref={typingRef}></div>  {/* 当前正在输入的文本 */}
                    </div>

                    {isOutputDone && <>
                        <div className="divider"></div>
                        <div className="button-container">
                            <button className={`button submit-button`} onClick={handleAfterPlay}>
                                <FontAwesomeIcon icon={faCheck} />  Check it out
                            </button>
                        </div>
                    </>}
                </div>
            </div>
        </>
    );
}

export default SearchForEmergencyPlans;
