// DeepSeek API 余额查询脚本 for Surge（iCloud 版 + 人民币不足1元提醒 + 增强错误诊断）
// 作者：Minis 助手（2026 优化版）

// === 配置部分 ===
const CONFIG_KEY = "deepseek_api_key";
const LOW_BALANCE_THRESHOLD = 1;         // CNY 不足 1 元提醒

// 读取或初始化 API Key
let API_KEY = $persistentStore.read(CONFIG_KEY);

if (!API_KEY) {
    $notification.post("DeepSeek Key 设置", "首次使用，请输入你的 DeepSeek API Key", "");
    
    $input("请输入 DeepSeek API Key (sk- 开头)", "text", "", (key) => {
        if (key && key.startsWith("sk-")) {
            $persistentStore.write(key, CONFIG_KEY);
            $notification.post("设置成功", "DeepSeek API Key 已保存", "请重新点击面板查询");
            $done({});
        } else {
            $notification.post("设置失败", "Key 格式不正确（需 sk- 开头）", "");
            $done({});
        }
    });
} else {
    // === 查询余额 ===
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
                content: "网络请求失败\n请检查网络或 Key 是否有效",
                icon: "exclamationmark.circle",
                "icon-color": "#FF3B30"
            });
            return;
        }

        try {
            // === 增强诊断：打印原始数据（仅调试用，正式可注释）===
            // $notification.post("Debug", "原始响应: " + data.substring(0, 300), "");  // 如需调试可取消注释

            const result = JSON.parse(data);

            // 更宽松的判断：只要有 balance_infos 数组即可
            if (result && result.balance_infos && Array.isArray(result.balance_infos)) {
                let content = "";
                let isLow = false;
                let hasCNY = false;
                let totalCNY = 0;

                result.balance_infos.forEach(info => {
                    const balanceStr = info.total_balance || "0";
                    const balance = parseFloat(balanceStr) || 0;
                    const curr = (info.currency || "").toUpperCase();

                    content += `${curr}：总余额 ${balanceStr}（赠送 ${info.granted_balance || 0} | 充值 ${info.topped_up_balance || 0}）\n`;
                    
                    if (curr === "CNY") {
                        hasCNY = true;
                        totalCNY = balance;
                        if (balance < LOW_BALANCE_THRESHOLD) isLow = true;
                    }
                });
                
                content += `\n可用：${result.is_available !== false ? "是" : "否"}`;

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
                // 格式异常时显示原始信息，便于诊断
                $done({
                    title: "DeepSeek 余额查询",
                    content: "返回数据格式异常\n\n原始数据片段：\n" + 
                             (data ? data.substring(0, 400) : "无数据"),
                    icon: "exclamationmark.circle",
                    "icon-color": "#FF9500"
                });
            }
        } catch (e) {
            $done({
                title: "DeepSeek 余额查询",
                content: "JSON 解析失败：" + e.message + 
                         "\n\n原始数据片段：\n" + (data ? data.substring(0, 300) : "无数据"),
                icon: "exclamationmark.circle",
                "icon-color": "#FF3B30"
            });
        }
    });
}