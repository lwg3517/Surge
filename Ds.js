// DeepSeek API 余额查询脚本 for Surge（纯本地 + 配置变量 + 人民币不足1元提醒）
// 作者：Minis 助手（优化版）

// === 配置部分 ===
const CONFIG_KEY = "deepseek_api_key";   // 持久化存储的 Key 名
const LOW_BALANCE_THRESHOLD = 1;         // 人民币不足提醒阈值（CNY），当前设为 1 元

// 读取或初始化 API Key
let API_KEY = $persistentStore.read(CONFIG_KEY);

if (!API_KEY) {
    // 首次运行，弹出输入框设置 Key
    $notification.post("DeepSeek Key 设置", "首次使用，请输入你的 DeepSeek API Key", "");
    
    $input("请输入 DeepSeek API Key (sk- 开头)", "text", "", (key) => {
        if (key && key.startsWith("sk-")) {
            $persistentStore.write(key, CONFIG_KEY);
            $notification.post("设置成功", "DeepSeek API Key 已保存", "请重新点击面板查询余额");
            $done({});
        } else {
            $notification.post("设置失败", "Key 格式不正确（需 sk- 开头）", "");
            $done({});
        }
    });
} else {
    // === 有 Key 时执行查询 ===
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
                let isLow = false;
                let hasCNY = false;

                result.balance_infos.forEach(info => {
                    const balance = parseFloat(info.total_balance) || 0;
                    content += `${info.currency}：总余额 ${info.total_balance}（赠送 ${info.granted_balance} | 充值 ${info.topped_up_balance}）\n`;
                    
                    if (info.currency.toUpperCase() === "CNY") {
                        hasCNY = true;
                        if (balance < LOW_BALANCE_THRESHOLD) {
                            isLow = true;
                        }
                    }
                });
                
                content += `\n可用：${result.is_available ? "是" : "否"}`;

                // 如果没有 CNY 记录或余额不足，则提醒
                if (!hasCNY || isLow) {
                    isLow = true;
                }

                const iconColor = isLow ? "#FF3B30" : "#34C759";
                const icon = isLow ? "exclamationmark.triangle" : "dollarsign.circle";
                let title = "DeepSeek 余额";
                
                if (isLow) {
                    title = "⚠️ DeepSeek 余额不足";
                    content += `\n\n人民币余额不足（< ${LOW_BALANCE_THRESHOLD} 元），请及时充值！`;
                }

                $done({
                    title: title,
                    content: content.trim(),
                    icon: icon,
                    "icon-color": iconColor
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
}