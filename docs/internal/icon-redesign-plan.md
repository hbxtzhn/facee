# FaceE 图标重设计方案

**编制说明**:仅依据材料一(委托方立场)、材料二(图形设计评审)、材料三(工程规格)写作;未重新解码 PNG、未跑构建、未改动仓库文件。材料二/三自述「未跑构建」「只读不写」,故本文「实测」均为离线资产测量,端到端以 `npx expo prebuild --clean` / `run:android` 产物为准。两处硬冲突(明暗极性、代码蓝)在第二节标明立场与证据,**不折中**。本文唯一自跑校验:按 WCAG 2.x 复算材料二对比度,输出与材料一致(`#1F2428` on `#F7F6F1`=14.47:1、`#2B58DB` on `#F7F6F1`=5.51:1、`#96C7F5` on `#E6F4FE`=1.59:1、纸色三档 1.05/1.08/1.10:1);另测得工程案 `#F9F9F6` on `#1F2428`=**14.84:1** —— 两案均达标,极性之争非可读性之争。

**结论**:方向「纸上墨迹」、墨以 JetBrains Mono 笔法落笔;主形「墨勾落纸」、备选「纸上等宽 >」;全组 1024×1024 母版 + 108dp/66dp 安全区,删 backgroundImage 让 backgroundColor 单轨生效,新增启动图。但「浅纸深墨」与「深石墨底」两套色彩方案**未收敛,拍板前不得实施**。

---

# 一、现状与问题

数据引自材料二解码实测 + 材料三 PNG 头实测(均未跑构建):

| # | 事实 | 数值 |
|---|---|---|
| 1 | icon.png(1024²,colorType=2)被浅蓝底淹没 | `#E6F4FE` 占 **74.7%**(783,401px) |
| 2 | 字形发灰、几乎看不见 | Λ 区(284,290)-(742,704)面积 172,619px=16.5%,均值 `#96C7F5`(渐变 #1686E9→#EFF7FF);Λ vs 底 **1.59:1**,最深 3.33:1 |
| 3 | 发灰的直接原因 | foreground(512²)alpha 从顶点 248→112→0,Λ 下半段按约 40% 透明度渲染 |
| 4 | 残留构造线/光晕(委托方原话被像素级证实) | 字形 bbox 外另有 170,429px(16% 画布)非底非字浅蓝标记 (224,240,248)/(216,232,240)/(144,192,232) |
| 5 | 图形尺寸压线 | Λ 横向 48.4dp(rel 0.277–0.725),压在 48–66dp 推荐下限;需缩到 0.79 倍才进安全圆 |
| 6 | monochrome 已存在但读法老旧 | 432²,最远半径 32.4dp 在 33dp 安全圆内;继承同一个 Λ 读法 |
| 7 | 配置实现坑 | app.json:13 backgroundColor `#E6F4FE` 与 :15 backgroundImage(实测 background.png 整幅即 #E6F4FE)并存时**以后者为准**,只改 :13 色值字符串不生效(材料三引 sdk-57 源码注释 `backgroundImage overrides backgroundColor`) |

**五个问题**:①**辨识度失效** —— 1.59:1(对比目标 14.47:1)意味着字形肉眼几乎看不见,不是风格问题是可读性问题;②**工艺缺陷** —— 渐变 + alpha 衰减 + 16% 画布残留构造线,不符「整块实心、扁平像素、无 clip/mask」要求;③**语义失效** —— Λ 读作「展开/更多/chevron」不承载品牌,74.7% 浅蓝让图标读成「某个蓝色工具」、与米白界面脱节;④小尺寸与 OEM 激进裁切下无余量;⑤backgroundImage 与 backgroundColor 并存,形成「改了不生效」的配置债务。

---

# 二、设计方向(委托方与设计师商量的结论;分歧已标注)

## 2.1 已达成的结论

1. **「纸上墨迹」方向成立**(材料一提出,材料二「同意,但要修正两点」)。**修正一**:纸色不用 `#F9F9F6`,取 **`#F7F6F1`**(colors.surfaceWarm,src/theme/index.ts:9)—— 实测纸色三档 vs 纯白仅 1.05/1.08/1.10:1,**没有任何纸色能让图标块在白壁纸上立起来**,纸色只为「纸感」不为「分块」,分块交给 launcher 的 rim/阴影。**修正二**:**墨迹不做毛笔/书法笔触**;调性是等宽代码 + Git 仓库 + 离线,墨以 JetBrains Mono 笔法落笔:等粗、方头切口、顿笔起锋(src/theme/index.ts:110-113)。**绝对不画描边**:theme:24 自写「配合阴影弱化『框感』」,加 #E8E8E2 边是自我否定。
2. **主形定为「墨勾落纸」**(材料二第四案),替代委托方原倾向 a/b;委托方事先声明候选「可以反对/修正」,故按证据收敛(见 2.3)而非投票。
3. **备选定为「纸上等宽 `>`」**,同时承接委托方「延续现有 caret」的诉求(b 的可执行版本);候选 c(气泡+勾)不再保留。
4. **自适应结构**(材料一 × 材料三一致):背景=纸色、前景=墨色字形、monochrome=字形剪影(Android 13+ 主题图标);三层路径全部不变,只替换文件内容。
5. **删除 backgroundImage、backgroundColor 单轨生效**。
6. **范围**:新增 `assets/splash-icon.png`;favicon 维持 48×48;通知图标暂缓(材料三实测 package.json 38 项 runtime 依赖无 expo-notifications)。

## 2.2 分歧一:明暗极性(未决,需委托方拍板)

| 立场 | 底 | 字形 | 代码蓝 | 论据 |
|---|---|---|---|---|
| 委托方(材料一) | 米白纸色 | 碳墨色 | 可选极小面积点缀 | 「纸上墨迹」方向原文 |
| 设计师(材料二) | `#F7F6F1` | `#1F2428` | 保留,≤1%,只做光标 | 实测 14.47:1;纸色三档实测;theme 逐行出处 |
| 工程规格(材料三) | `#1F2428` | `#F9F9F6` | **禁止出现** | 「深石墨为主色,替换与米白界面脱节的浅蓝」;验收清单禁 `#2B58DB`/`#E6F4FE` |

- **判断(执笔人)**:这是两套相反的图标,不是改个色值的事。工程规格**未给任何对比度/小尺寸实测**支撑这个反转,也没回应「分块靠 rim/阴影、纸色不为分块」的论证;本文复算两案均达标(14.47:1 / 14.84:1),**这是品牌取向之争,非可读性之争**。
- **影响面**:取色表、七张图的背景/前景、app.json 的 `adaptiveIcon.backgroundColor`、验收「取色核对」;若采纳工程规格,则 2.4 蓝块同时作废、第三节主案构成需改写。
- **一处不冲突**:工程规格自己的启动图仍是 `#F9F9F6` 纸底(并注明「应用本身是单一米白纸感,无暗色设计」)—— 深色只针对桌面图标,不代表 App 走暗色。
- **要求**:拍板前不得同时实施两套;本文正文按图纸案撰写,工程规格在受影响处逐处标注。

## 2.3 分歧二:主形(已按证据收敛)

委托方原倾向 a(F+对勾)或 b(墨色 Λ),自称「未定」「可以反对/修正」。设计师**反对 a**:48px 实测竖笔 5–6px、勾短臂仅约 4px,竖笔与勾膝接壤处**糊成约 15px×4px 墨团**,读作「带一道斜杠的 F」;F 在 launcher 无独占性(figma/firefox/facebook/framer),差异化在「离线题库+掌握闭环」不在首字母。**反对 c(气泡+勾)**:48px 下纸色挖空的短臂完全消失,只剩一道白口;monochrome 挖空被填死成**带尾巴的实心圆角块**,Android 13 主题图标下报废。**b 只同意作延续方案**:读作 chevron、说不出品牌、需缩 0.79 倍才进安全圆。**结论**:主案墨勾落纸,备选一纸上等宽 >,备选二 {} 题库;a/c 不再列为可选项。

## 2.4 分歧三:代码蓝(未决)

材料一:可选极小面积。材料二:保留 ≤1%,只做「终端光标」;src/theme/index.ts:41-42 明写蓝=行内代码前景色,故蓝只能意味「代码」;三禁令:①不做背景/第二笔画(现状即 74.7% 铺浅蓝);②不用 success `#2E7D32` 画勾(theme:31 定义为语义状态色,绿勾只读成待办/健康);③不渐变、不 alpha 衰减(必须整块 255 实心)。材料三:任何资产禁止 `#2B58DB`,**未给理由**。判断:设计师有面积预算(4.2)+5.51:1 实测,工程规格无论据;若采工程规格,主案「挑尖后光标方块」作废,第三/六节需同步改写。

## 2.5 未决项

| 未决项 | 图纸案 | 工程规格案 | 本文默认 |
|---|---|---|---|
| 明暗极性 | `#F7F6F1` + `#1F2428` | `#1F2428` + `#F9F9F6` | 图纸案 |
| 代码蓝 | ≤1% 光标 | 禁止 | 图纸案保留 |
| 主形 | 墨勾落纸 | 未涉及 | 墨勾落纸 |

---

# 三、图形方案

## 3.1 主案:墨勾落纸

- **构成**:14dp 顿笔起、尖锋收的碳墨对勾(短臂:长臂≈**1:2.2**),最短臂端点起笔,长臂向右上斜挑收尖;挑尖后隔 2–3dp 空隙放 **9–10dp `#2B58DB` 实心方块**(终端光标);108dp 画布圆心居中,外向最远 **30.5dp**(安全圆 33dp 内留 2.5dp 余量给激进裁切)。
- **理由**:App 的闭环就是「答对」—— README.md:28(收藏/继续上次/刷题总数)+ 提交 7556687「掌握度标记、错题本、练习队列」+ d4f573c「题目级掌握度(会/模糊/不会)」,图标回答「这道题我会了」;「纸+墨」由 theme:5 `#F9F9F6` 与 :12 `#1C1E21` 给足;蓝是全 App 唯一蓝且 theme:41-42 定义为行内代码前景色,只能意味「代码」,光标方块面积小到不会把图标变成蓝色系应用;不做 F、不做气泡,那两个符号都是别人的语言。
- **小尺寸可读性(实测)**:自写栅格化器按 108dp 安全圆适配输出 48px 真实像素:笔画 **5.8–6.2px**,1:2.2 比例与夹角清晰,收尖不糊;墨覆盖 **5.8%**、蓝块 **0.7%**(约 4×4px);同批实测唯一与小尺寸稳定共存;48×48 favicon 同样成立。
- **单色版**:单层剪影就是勾本身,零改动可直接作 monochrome;蓝块并入 launcher tint 或去掉,剪影不受影响;无内部结构,不被 OEM 裁切形状吃掉。
- **风险**:①勾是待办/清单通用符号,形状不独占,区分度全靠「纸底+墨色+等宽笔法」语言;②只说闭环一半,「离线题库」由名字和界面补;③蓝块必须贴长臂轴线并对齐像素网格,歪一格 48px 像脏东西;OEM 把 108dp 压到 96dp 显示时蓝块先消失(可接受损失)。

## 3.2 备选一:纸上等宽 `>`

- **构成**:JetBrains Mono 的 `>` 字符形,11dp 等粗折角、方头切口、顶点在右,两臂指左上与左下;可选顶点一小段 `#2B58DB`(约 6dp、0.2%)。纸底+墨色,无描边。
- **理由**:theme:110-113 把 JetBrains Mono 设为全 App 唯一等宽字体;README.md:9「题库就是一个 Git 仓库」「装完就能断网」给终端/本地气质;用户是中文程序员;优势是**有字体系统可延续**(深色模式、主题图标、空状态插图复用同一套字符语法);同时是委托方 b 的可执行延续。
- **小尺寸可读性(实测)**:48px 笔画 4.9px、墨覆盖 5.5%,折角读法稳定无糊团;方头切口保留硬边。
- **单色版**:单层剪影完美成立;顶点那点蓝在主题图标里被 tint 吸收。
- **风险**:与现状 Λ 同 chevron 家族,读成「展开/更多/上一层」概率不低;说「程序员」不说「题库/答对」,信息量低一档;等于放弃产品语义只留人群语义。

## 3.3 备选二:{} 题库(小尺寸优先场景不推荐)

- **构成**:一对 8dp 等粗花括号(中部内凹尖角+上下回钩),左右间距≈笔画宽;纸底墨色方头;可选左钩尖点 4–6dp 蓝(≈0.1%)。
- **理由**:README.md:33-41 题库入口是一份 catalog.json,花括号=容器=JSON=代码,一眼「一仓库题」,与「换题库不用换 App」同源;比 F 有信息量,比 `>` 更贴近产品。
- **小尺寸可读性(实测)**:48px 笔画 **3.6px**(最细最脆弱)、墨覆盖 6.8%;回钩角部只剩 1px 有余边缘,是缩放第一个牺牲处;要做至少笔画提到 9–10dp 并扩字距。
- **单色版**:两条 C 形剪影可成立,但回钩与内凹尖在单色 tint 下减弱,不如前两个稳。
- **风险**:解释载体而非结果,与「面试题库」场景连接弱于勾形。

---

# 四、色彩与适配策略

## 4.1 取色表(全部从现有 theme 取色,不引新色)

| 用途 | 色值 | 出处 | 说明(含实测) |
|---|---|---|---|
| 背景层/底(图纸案) | `#F7F6F1` | theme:9 surfaceWarm | 最暖、最经得起灰壁纸;vs 纯白 1.08:1,分块靠 launcher rim/阴影 |
| 前景/字形(图纸案) | `#1F2428` | theme:18 primary | 不用 #1C1E21(:12 正文色会让图案读成一段正文);墨 on 纸 **14.47:1** |
| 光标 | `#2B58DB` | theme:41-42 行内代码前景色 | ≤1% 面积;on 纸 **5.51:1**,过 3:1 图形标准 |
| 纸感/启动图底 | `#F9F9F6` | theme:5 | 启动图背景用它;不作图标底 |
| 禁用 | `#E6F4FE`、大面积 `#2B58DB`、`#2E7D32`、`#E8E8E2`、一切渐变/半透明 | — | 现状浅蓝底 / 语义成功色(:31)/ 边框色(:24) |
| (工程规格案) | 底 `#1F2428` + 字 `#F9F9F6` | 材料三 | 与图纸案互为明暗反转;复算 14.84:1 同样达标 |

## 4.2 蓝块面积预算(仅图纸案且分歧三采纳保留蓝时有效)

实测:4dp=0.09%、6dp=0.19%、8dp=0.32%、10dp=0.54%(48px 下 4.4px)、12dp=0.86%(5.3px)。**推荐 9–10dp(约 0.7%,48px 约 4×4px)**,放对勾挑尖后沿长臂轴线 2–3dp 空隙,读作终端光标。三禁令:①不做背景或第二笔画;②不用 `#2E7D32` 画勾;③不渐变、不 alpha 衰减,整块 255 实心。

## 4.3 themed icon(Android 13+ 单色/主题图标)

app.json:16 已有 `monochromeImage` 挂载点,保留挂载点、内容换纯剪影;剪影最远 30.5dp < 33dp 安全圆,不被裁;蓝块在单色版去掉(工程案下自动 moot)。实践建议(非文档规定):单层+alpha、整张只一个颜色值(白或黑均可)、同 108dp 画布;Android 16 QPR2 起不提供该层也会被自动主题化,故应主动提供。验收:真机开「主题图标」,或 monochrome 单独转剪影置于浅/深壁纸,确认轮廓可读、无第二色残留。

## 4.4 深色桌面 / 壁纸

实测 `#F9F9F6` vs 纯白 1.05:1、`#F7F6F1` 1.08:1、`#F4F4F0` 1.10:1 —— **没有任何纸色能让图标块在白壁纸上立起来**。结论:放弃「分块」目标,靠 launcher 的 rim/阴影;纸色只为浅灰壁纸上多一分区别,取最暖的 `#F7F6F1`;绝不描边。若采纳工程案深色底,本节论证作废,深色块在深/浅壁纸下的 rim 依赖需重新实测(材料未提供,标注为空白)。

## 4.5 圆形裁切与 OEM mask

三层:108×108dp 画布、66×66dp 安全圆(33dp 半径)、最外 18dp 保留给 mask(Android 官方规范,经材料三引用)。主形最远 30.5dp,安全圆内留 2.5dp;OEM 有把 108dp 压到 96dp 显示的,蓝块先消失(可接受);剪影无内部结构不被裁。1024 母版换算:安全区 626×626(61.11%)、最小可辨框 455×455(44.44%,对应 48dp)、四边各 171px(16.67%,对应 18dp)。验收:以圆、圆角方形/squircle、水滴形分别裁切预览,确认不被 mask 裁掉、四边无残迹。

---

# 五、图片规格(逐文件)

全组统一:1024×1024 母版、108dp 画布、66dp(61.11%)安全区;路径不变,只替换内容。色值为**图纸案**,工程规格案见 4.1 末行。

| 文件 | 尺寸 | 格式 | 约束 | 依据 |
|---|---|---|---|---|
| `assets/icon.png`(替换) | 1024×1024 | PNG 8bit,**必须完全不透明**(colorType 2,与现状一致);sRGB(若用 P3 则整套统一) | 整幅填满正方形,禁圆角、禁四周透明边;底 `#F7F6F1` + 字形 `#1F2428`;图纸案仅允许 ≤1% 光标蓝(工程案禁一切蓝);必须先删净现有构造辅助线(圆圈、虚线);字形建议放大到 60–62dp 级别(1024 画布中心),不必缩到 48dp;用于 iOS 主屏 + Expo Go | Expo v57 文档「1024x1024 png」「exactly square」「Fill the full square with no rounded corners or other transparent pixels」;仓库实测 1024×1024 colorType=2;尺寸建议来自材料二 |
| `assets/android-icon-foreground.png`(替换) | 1024×1024 | PNG-32(RGBA,8bit alpha);若保留 backgroundImage 两者须同尺寸 | 只放字形、背景全透明;外接框必须落在中央 626×626(61.11%)内、建议 455–626px(44.44%–61.11%);四边各留 171px(16.67%)给 mask;禁描边/投影/外发光;不用 clip/mask 图层,扁平导出;≥512×512 是文档下限,取 1024 为共用母版且 ≥ 预构建最大输出 432px;必须整体重绘为实心字形(现状半透明渐变) | Expo 文档「Use .png files」「at least 512x512」「same dimensions as your foreground image」;developer.android.com「108x108 dp」「must not exceed 66x66 dp」「outer 18 dp reserved for masking」;sdk-57 `withAndroidIcons.ts`(108/162/216/324/432) |
| `assets/android-icon-background.png`(**建议删除**) | 若保留:1024×1024 | PNG 满幅不透明单色,同 foreground 尺寸 | 零渐变零纹理;文档强制 backgroundImage 与 foregroundImage 同尺寸且**会覆盖 backgroundColor**;平色背景用 backgroundColor 更稳,故删字段+删文件 | Expo 文档「Must have the same dimensions as foregroundImage」「overrides the backgroundColor key」;sdk-57 源码注释 |
| `assets/android-icon-monochrome.png`(替换) | 1024×1024 | PNG-32(RGBA),同母版、同 108dp 画布 | 单色+alpha:整张只允许一个颜色值(建议 `#FFFFFF` 或 `#000000`),形状完全由 alpha 承载;禁渐变、第二色、半透明灰过渡、投影;图形同样收在 626×626;用于 Android 13+ Themed icons;Android 16 QPR2 起不提供也会被自动主题化,故应主动提供;蓝块去掉 | Expo 文档 monochromeImage「Android 13+ monochromatic icon ... Themed icons」;Android 指南「provide a single layer for the monochrome version」、`<monochrome>` 同 108dp 画布 |
| `assets/favicon.png`(替换,规格不变) | 48×48 | PNG-32(RGBA 允许) | Expo v57 对 favicon 无任何尺寸/格式要求(仅一句「Relative path of an image to use for your app's favicon」),故只换内容;仅影响 expo web 产物,不影响 Android APK;建议 16×16 与 48×48 双尺寸目视 | Expo 文档 web.favicon(无尺寸说明);仓库实测 48×48 colorType=6 |
| `assets/splash-icon.png`(新增) | 1024×1024 | PNG-32(RGBA),背景透明(Expo 明文透明底,仅支持 png) | 图形居中不贴边、收在中央安全区;配 expo-splash-screen 插件:`backgroundColor #F9F9F6`、`imageWidth 200`(文档示例值)、`resizeMode contain`;不提供 dark 变体(应用本身单一米白纸感,无暗色设计) | Expo app-icons 文档「Use a 1024x1024 image.」「Use a .png file.」「Use a transparent background.」;splash-screen 插件文档(默认 imageWidth 100 / resizeMode contain\|cover\|native) |
| `assets/notificationIcon.png`(**暂缓**) | 96×96 | 全白 + 透明 PNG | Expo 原文「96x96 all-white png with transparency」;现在不做:无 expo-notifications 依赖(实测 38 项),没有插件/通道引用它;未来接推送时再补,并同步 expo-notifications 插件 icon + color | Expo notifications 文档;仓库实测 package.json |

**「非文档结论」标注**(材料三自列):①1024×1024 源图尺寸是工程建议,Expo 只说至少 512×512 且不校验源图尺寸;②66/108/18dp 三个数字来自 developer.android.com,非 Expo 文档;③monochrome 像素尺寸与颜色值 Expo/Android 均未规定,「同 108dp 画布、单色+alpha」是从 `<adaptive-icon>` 结构推断的实践建议;④favicon 48×48 是仓库实测现状,非文档要求;⑤splash imageWidth 单位(dp/px)文档未明说;⑥iOS 颜色空间只引用 Expo 复述,未逐条核对 Apple HIG 原文。另:icon.png 字形占 60–62dp 的建议来自材料二,工程规格未规定。

---

# 六、app.json 修改点与制作验收清单

## 6.1 字段级改动(6 处,路径全不动)

1. `expo.icon`:路径不变,只替换内容(1024×1024 满幅不透明)。
2. `expo.android.adaptiveIcon.backgroundColor`:`'#E6F4FE'` → 图纸案 `#F7F6F1` / 工程案 `#1F2428`(文档:6 位十六进制,默认 #FFFFFF)。
3. `expo.android.adaptiveIcon.backgroundImage`:**删除该字段**及 `assets/android-icon-background.png` —— 背景图必须与前景同尺寸且会覆盖 backgroundColor,平色背景直接用 backgroundColor 更稳。
4. `foregroundImage` 与 `monochromeImage`:路径不变,只替换内容(均 1024×1024 RGBA)。
5. `expo.plugins`:追加 `["expo-splash-screen", { "backgroundColor": "#F9F9F6", "image": "./assets/splash-icon.png", "imageWidth": 200, "resizeMode": "contain" }]` 作为数组项(与现有字符串插件 `./plugins/withAndroidArm64Release` 并存)。
6. `expo.web.favicon`:路径与规格均不变,仅替换内容。
不动:name/slug/version/orientation/ios/android.package/versionCode/permissions/predictiveBackGestureEnabled。

预览形态(分歧处占位,其余为材料三原样):

```json
"expo": {
  "icon": "./assets/icon.png",
  "android": {
    "adaptiveIcon": {
      "backgroundColor": "<待定:#F7F6F1 图纸案 | #1F2428 工程规格案>",
      "foregroundImage": "./assets/android-icon-foreground.png",
      "monochromeImage": "./assets/android-icon-monochrome.png"
    }
  },
  "plugins": [
    "./plugins/withAndroidArm64Release",
    ["expo-splash-screen", { "backgroundColor": "#F9F9F6", "image": "./assets/splash-icon.png", "imageWidth": 200, "resizeMode": "contain" }]
  ]
}
```

(启动图 `backgroundColor` 两案不冲突 —— 工程规格自己也用 #F9F9F6 纸底,并注明应用无暗色设计。)

## 6.2 三个必须一起改的实现坑(材料二像素测量 + 材料三源码核实)

1. 只把 app.json:13 色值改成纸色**不会生效** —— :15 的 backgroundImage(实测 background.png 整幅就是 #E6F4FE)优先;要么删 :15 让 backgroundColor 生效(本方案采纳),要么把 background.png 换成纸色实心图。
2. `foreground.png` 必须整体重绘为实心字形(现在 Lambda 是半透明渐变)。
3. 1024² 的 `icon.png`(iOS/PWA/商店)无 Android 那种激进裁切,同一图形可放大到 60–62dp 级别(1024 画布中心),不必缩到 48dp。

## 6.3 制作验收清单(材料三 13 项,色值项按两案改写)

1. 【母版】1024×1024 画布,建三层常驻参考线:居中 626×626 安全区框(61.11%)、455×455 最小框、四边 171px 预留带(各对应 66dp / 48dp / 18dp)。
2. 【清理】删除全部构造辅助层(现有 icon.png 残留的圆圈与虚线必须删净)、删除所有 clip mask、JetBrains Mono 字形先转曲;合并后只保留一个像素层。
3. 【约束】描边/投影/外发光一律不加;图形不越 626px 安全区框;外接框建议落在 455–626px 之间,保证 48px 仍可辨。
4. 【导出】按第五节表导出 foreground(透明)/monochrome(透明单色)/icon(满幅不透明)/splash(透明)/favicon(48×48);PNG-32、8bit、不交错;文件名路径严格照旧。
5. 【校验 A:像素】新文件上运行 PNG 头校验,确认 w/h=1024、icon.png colorType=2 无 alpha、其余 colorType=6;命令(材料三原文):`node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);console.log(f,b.readUInt32BE(16),b.readUInt32BE(20),b.readUInt32BE(20)*0+b.readUInt32BE(0)+' colorType='+b[25])}" assets/icon.png assets/android-icon-foreground.png assets/android-icon-monochrome.png assets/splash-icon.png`。**本方案未执行该校验**(本次只写方案、未产出新资产),执行时机=新资产导出后。
6. 【校验 B:48px 预览】每张图缩到 48×48 目视(相当于旧设备 legacy 圆图标与 mipmap-mdpi 基线),字形仍须可辨识(设计师已对三案做过 48px 栅格化实测,见第三节)。
7. 【校验 C:圆形裁切】以 108×108 圆、圆角方形/squircle、水滴形分别裁切预览,确认图形不被 mask 裁掉、四边无残迹。
8. 【校验 D:themed icon】Android 13+ 开「主题图标」看真机(或 monochrome 单独转剪影后置于浅/深壁纸),确认轮廓可读、无第二色残留。
9. 【校验 E:启动图】imageWidth 200 + contain 下,在小屏(1080×1920)与大屏/全面屏安全区检查字形居中与留白。
10. 【校验 F:favicon】16×16 与 48×48 下检查字形仍可读。
11. 【取色核对】所有资产不得出现 `#E6F4FE` 与原浅蓝底。图纸案:不得出现 `#2B58DB` 以外任何蓝,允许 `#F7F6F1` + `#1F2428` + ≤1% 光标蓝;工程规格案:不得出现 `#2B58DB` 与 `#E6F4FE`,允许底 `#1F2428` + 字形 `#F9F9F6`(替代 `#1C1E21`)。
12. 【构建核对】改完 app.json 跑 `npx expo prebuild --clean`(或 EAS 构建),检查 `android/app/src/main/res/mipmap-mdpi..xxxhdpi/ic_launcher_{foreground,background,monochrome}.webp` 尺寸为 108/162/216/324/432,以及 `android/app/src/main/res/values/colors.xml` 中 `iconBackground` = 图纸案 `#F7F6F1` / 工程案 `#1F2428`。
13. 【真机验收】安装后依次看桌面图标、长按菜单图标、Android 13+ themed 图标切换、冷启动启动图;无 expo-notifications 依赖,跳过通知图标项。

---

# 七、范围外

1. **App 内 lucide 图标:结论 = 不重做。** 理由:①三份材料界定的资产范围是固定文件清单(icon / foreground / monochrome / favicon / splash / notification),没有任何一项指向 App 内 UI 图标库;②本方案全部论证(launcher 48px 栅格化、108dp 安全区、themed icon、商店 1024)都是「桌面入口层」问题,lucide 的描边体系、24px 网格与 stroke-width 语义属于另一套规格,替换它会波及每个界面,远超本次范围;③材料二给出的可延续资产是「JetBrains Mono 字符语法」,将来若要统一 UI 插图/空状态语言,那是独立的 in-app 视觉项目,应另行立项验收。**诚实标注**:三份材料均未提及 lucide,此结论由范围推导,非材料明示;若委托方把「in-app 图标语言统一」列为目标,需要新输入(in-app 图标清点、使用场景清单),不在本方案内。
2. **通知图标暂缓**:Expo 要求 96×96 全白透明 PNG;仓库无 expo-notifications(实测 38 项依赖无名);未来接推送时再补,并同步 expo-notifications 插件 icon + color。
3. **iOS Icon Composer(app.icon 目录)**:仅资料性核对(SDK 54+ 支持、可给 light/dark/tinted),未展开目录格式与内部规格,本次不采用。
4. **App 内主题色 / UI 不动**:本方案只从现有 theme 取色、不引新色,`src/theme/index.ts` 无需修改。
5. **「离线题库」语义不由图标承担**:材料二明说图标只表达闭环的一半,另一半由名字和界面补 —— 是既定设计判断,不是疏漏。
6. **端到端构建验证未做**:材料二/三均声明未跑构建;prebuild 输出 108/162/216/324/432 webp 是读 sdk-57 源码常量得出,不是构建产物实测;v57 是否仍支持顶层 json 的 splash 键未查到,故第六节只给插件法。
