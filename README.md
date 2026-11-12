# 鹈鹕骑单车 · 海岸大冒险（Pelican Ride）

**中文** | [English](README.en.md)

一只戴头盔、围红围巾的白鹈鹕，骑着复古单车沿海岸线追鱼、飞跃跳台、做空中特技。
实时 3D 无尽跑酷，模型、地形、天空、海浪、音效和音乐全部由代码生成，没有任何外部素材。

**在线试玩：<https://pelicanride.vercel.app>**（支持中文 / English）

> 本项目由 Fable 5.2 制作。

[![宣传视频（点击观看带声音的完整版）](docs/promo.gif)](https://pelicanride.vercel.app/promo.mp4)

▶ [观看 32 秒完整宣传片（带声音）](https://pelicanride.vercel.app/promo.mp4) —— 画面是游戏实机逐帧录制，声音是游戏自己实时合成的音乐和音效。

## 玩法

抓鱼攒连击，连击越高倍率越高；攒满狂热槽会下鱼雨、得分翻倍。撞到障碍掉一颗心，三颗心掉光本局结束。
抓到的鱼会存进钱包，可以在车库换帽子、眼镜、围巾、车漆、尾迹和强化。

| 按键 | 作用 |
|---|---|
| `A` `D` / `←` `→` | 左右转向 |
| `W` / `S` | 用力蹬 / 刹车 |
| `空格` | 跳跃；空中再按一次扑翅二段跳；空中按住展翅滑翔 |
| `T` | 空中特技：单按后空翻，配 `←` `→` 转体，配 `↑` 超人式；地面按住放手翘头 |
| `Shift` | 辣椒冲刺：无敌并撞飞障碍 |
| `B` | 车铃：赶走海鸥 |
| `H` | 大叫：吓跑螃蟹，把鱼吓出海面 |
| `C` `P` `M` | 切换镜头 / 暂停 / 音乐开关 |
| `K` `F` `U` `N` | 截图 / 全屏 / 隐藏界面 / 时间快进 3 小时 |

也支持触屏按钮和手柄。

## 内容

- **三种模式**：冒险、每日挑战（当天固定赛道）、悠闲骑行（不会失败，可调时间和天气，挂机自动驾驶）
- **六种路段**：海岸公路、渔村小镇、棕榈沙滩、灯塔悬崖、跨海大桥、樱花坡道
- **天气与事件**：昼夜循环、下雨打雷、雨后彩虹、极光、流星、鲸鱼跃出、海豚伴游、里程烟花
- **成长线**：37 个成就、滚动刷新的任务、车库装扮与五项强化，存档保存在浏览器本地
- **中英双语**：按浏览器语言自动选择，可在标题页或设置里切换；也可以用 `?lang=en` / `?lang=zh` 指定

## 技术

- [three.js](https://threejs.org/) + 自写着色器：昼夜天空与程序化云、Gerstner 海浪、带路灯光斑和雨天反光的路面
- 鹈鹕与单车完全程序化建模：双骨骼 IK 踩踏和握把、弹簧脖子、Verlet 布料围巾
- 按区块流式生成的无限赛道，每个区块的景物合并成一次绘制
- WebAudio 实时合成全部音效，以及节奏跟随车速和连击的生成式音乐
- 构建产物是一个可离线打开的单文件 `dist/index.html`

## 本地开发

```bash
npm install
npm run build      # 生成 dist/index.html，双击即可运行
npm run dev        # 不压缩的调试版本
```

`tools/` 里是基于无头 Chrome 的脚本（需要本机装有 Chrome，路径不同时设置环境变量 `CHROME_PATH` 或修改脚本里的路径）：

```bash
npm run test:keys          # 真实按键冒烟测试（可加参数 en 测英文版）
npm run test:sim           # 自动驾驶长时间快进模拟
node tools/promo-video.mjs # 重新录制宣传视频（需要 ffmpeg，可用环境变量 FFMPEG 指定路径）
```

宣传视频的录制方式：把游戏时钟换成虚拟时钟逐帧推进并截图，同时把游戏的 `AudioContext` 换成 `OfflineAudioContext` 离线渲染原声，最后用 ffmpeg 合成，所以不受录制机器帧率影响。

## 致谢

创意和界面风格参考了 [riba2534 的鹈鹕骑单车演示](https://github.com/riba2534/claude-opus-5-5-demo)，本仓库的代码为独立编写。
“让模型画一只骑自行车的鹈鹕”这个梗来自 [Simon Willison 的测评](https://simonwillison.net/tags/pelican-riding-a-bicycle/)。

## 作者

- GitHub：[@Xiobio](https://github.com/Xiobio)
- X：[@JunquanB](https://x.com/JunquanB)

## 许可

[MIT](LICENSE)
