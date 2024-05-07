import { useEffect } from "react";


function JessiePreAlert() {

    const firstString = "听说某人喜欢开宝箱？\n I heard you like to open treasure chests in Genshin?";
    const secondString = "今天让你开个够！！！\n Today, you can open as many as you want!!!";


    useEffect(() => {

        alert(firstString);
        alert(secondString);
        var input = prompt("前提是你喊我一声‘无敌的伟大的Tim哥’：\n You need to say 'Invincible great Tim' to open the treasure chest:");
        while (!(input === "无敌的伟大的Tim哥" || input === "无敌的伟大的tim哥" || input.toLowerCase() === "invincible great tim")) {
            alert("你不配开宝箱 \n You are not qualified to open the treasure chest");
            input = prompt("前提是你喊我一声‘无敌的伟大的Tim哥’：\n You need to say 'Invincible great Tim' to open the treasure chest:");
        }
        alert("好的，你可以开宝箱了，点击viewport开始。\n Okay, you can open the treasure chest now, click the viewport to start.");
    }, []);

    return (
        <></>
    );
}

export default JessiePreAlert;
