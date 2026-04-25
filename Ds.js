// DeepSeek API 余额查询脚本 for Surge
// 使用方法：在面板添加快捷方式，URL 填 http://surge.local/deepseek-balance

const API_KEY = "sk-f574df4e6a414ce7bf49f72570de728";  // ←←← 这里改成你的 Key

const options = {
    url: "https://api.deepseek.com/user/balance",
    headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Accept": "application/json"
    },
    method: "GET"
};

$httpClient.get(options, function(error, response, data) {
    if (error) {
        $done({
            title: "DeepSeek 余额查询",
            content: "请求失败，请检查网络或 Key",
            icon: "exclamationmark.circle",
            "icon-color": "#FF3B30"
        });
        return;
    }

    try {
        const result = JSON.parse(data);
        if (result.is_available !== undefined && result.balance_infos) {
            let content = "";
            result.balance_infos.forEach(info => {
                content += `${info.currency}：总余额 ${info.total_balance}（赠送 ${info.granted_balance} | 充值 ${info.topped_up_balance}）\n`;
            });
            content += `\n可用：${result.is_available ? "是" : "否"}`;

            $done({
                title: "DeepSeek 余额",
                content: content.trim(),
                icon: "dollarsign.circle",
                "icon-color": "#34C759"
            });
        } else {
            $done({
                title: "DeepSeek 余额查询",
                content: "返回数据格式异常",
                icon: "exclamationmark.circle",
                "icon-color": "#FF9500"
            });
        }
    } catch (e) {
        $done({
            title: "DeepSeek 余额查询",
            content: "解析失败：" + e.message,
            icon: "exclamationmark.circle",
            "icon-color": "#FF3B30"
        });
    }
});