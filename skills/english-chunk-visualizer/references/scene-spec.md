# Three.js 语义场景规范

把不可见的语义关系变成可以观察和操纵的空间模型。场景中的形状、运动、镜头和交互必须分别承担可说明的语义职责。

## 输出步骤

### 1. 判断视觉命题

先用一句话写明动画要证明的语义关系。视觉命题必须比“展示这个单词”更具体，例如：

> 主体的路径越过入口、沿区域内部延伸，并指向另一侧边界。

同时列出事实边界：表达本身编码什么、当前语境补充什么、动画为演示而选择但表达并不保证什么。路径具有终点不等于句中事件已经完成，完成状态应由时态、体和上下文判断。

完成标准：用户只看视觉命题和事实边界，就能判断场景抓住了什么，以及没有声称什么。

### 2. 设计视觉映射

说明：

- 实体：每个对象代表什么。
- 关系：边界、距离、接触、包围或路径代表什么。
- 动画：起点、过程、终点、速度和循环方式分别代表什么。
- 镜头：注意力落在哪里，是否需要切换视角。
- 视觉编码：颜色、透明度、光照或粒子密度分别代表什么。
- 交互：用户能操作什么，以及操作如何帮助检验理解。
- 用法切换：哪些视觉关系保持稳定，哪些随具体语境改变。

优先使用少量语义原语：

- `container`：容器或有内部结构的区域
- `surface`：承托、接触或覆盖面
- `boundary`：界限、门槛或状态分界
- `path`：运动或过程路线
- `orbit`：围绕中心或非定点分布
- `approach`：接近目标
- `separate`：脱离或离散
- `accumulate`：逐步积累
- `burst`：瞬间释放
- `focus`：注意力落点
- `fade`：逐渐减弱或消失

语义原语说明对象或运动为什么存在；`sphere`、`box`、`line` 等渲染几何体只说明如何画出来。两者分别记录，避免把视觉外形误当成语义。

完成标准：每个主要视觉元素都能映射回语义模型；无语义职责的装饰已经移除。

### 3. 输出 SceneSpec

输出合法 JSON，不写注释。使用下列结构；没有必要的字段可以省略，但不得改变字段含义。

```json
{
  "expression": "through",
  "usage": "physical-passage",
  "proposition": "主体的路径越过入口、沿区域内部延伸，并指向另一侧边界",
  "semanticClaims": {
    "encodedByExpression": ["路径经过参照区域内部，而不只跨过表面"],
    "suppliedByContext": ["参照区域是物理空间"],
    "notEntailed": ["句中事件已经完成；完成状态由时态、体和上下文决定"]
  },
  "coreSchema": {
    "invariant": "path-via-interior",
    "dimensions": ["path", "boundary", "process"]
  },
  "entities": [
    {
      "id": "traveler",
      "semanticPrimitive": "focus",
      "semanticRole": "移动主体",
      "geometry": "sphere",
      "style": {
        "color": "#ffcc33",
        "opacity": 1
      }
    },
    {
      "id": "region",
      "semanticPrimitive": "container",
      "semanticRole": "具有内部结构的区域",
      "geometry": "box",
      "style": {
        "color": "#5577aa",
        "opacity": 0.35
      }
    }
  ],
  "relations": [
    {
      "type": "path",
      "subject": "traveler",
      "reference": "region",
      "sequence": ["outside", "inside", "outside-opposite-side"]
    }
  ],
  "timeline": [
    {
      "at": 0,
      "action": "place",
      "target": "traveler",
      "state": "before-entry"
    },
    {
      "at": 0.25,
      "action": "enter",
      "target": "traveler",
      "reference": "region"
    },
    {
      "at": 0.75,
      "action": "traverse",
      "target": "traveler",
      "reference": "region"
    },
    {
      "at": 1,
      "action": "exit",
      "target": "traveler",
      "state": "opposite-side"
    }
  ],
  "camera": {
    "focus": ["traveler", "region"],
    "mode": "three-quarter"
  },
  "interactions": [
    {
      "type": "scrub-timeline",
      "learningPurpose": "观察进入、穿越和离开三个阶段"
    },
    {
      "type": "switch-usage",
      "options": ["physical-passage", "process-completion"],
      "learningPurpose": "识别不同用法中保持不变的路径结构"
    }
  ],
  "captions": [
    {
      "phase": "inside",
      "text": "重点不只是越过边界，而是在内部持续经过"
    }
  ]
}
```

字段约束：

- `proposition`：场景要证明的单一视觉命题。
- `semanticClaims.encodedByExpression`：目标表达本身编码、动画可以直接主张的关系。
- `semanticClaims.suppliedByContext`：由当前搭配或语境补充的关系。
- `semanticClaims.notEntailed`：动画容易让人误推、但表达本身不保证的关系。
- `coreSchema.invariant`：不同场景切换时保持不变的关系。
- `dimensions`：只列本场景确实编码的维度。
- `semanticPrimitive`：说明实体承担哪类语义职责。
- `semanticRole`：用当前场景的具体含义解释对象为什么存在。
- `geometry`：说明默认渲染几何体，不承载独立语义。
- `relations`：表达实体间的语义关系，而非渲染层父子关系。
- `timeline.at`：使用 `0` 到 `1` 的归一化时间。
- `learningPurpose`：每项交互必须说明学习价值。
- `captions`：只标记视觉本身难以精确表达的关键点。

完成标准：JSON 可解析，所有实体 ID 引用有效，时间值有序且位于 `0` 到 `1`，每项交互都有学习目的。

## 实现约束

Three.js 分支默认生成一个独立 HTML 文件：

1. 将 `SceneSpec` 放进 `<script type="application/json" id="scene-spec">`，页面启动时解析它。阶段阈值、实体、关系和用法差异都从这里派生。
2. 把单文件当作包装约束。代码可以内联，但视觉层次、交互、响应式行为和语义反馈保持完整；已有参考实现时，先记录基线并在内联后逐项对照。
3. 将 HTML、CSS 和页面逻辑放在同一文件。默认使用支持 `file://` 页面的固定版本 Three.js CDN 构建，不依赖本地文件的 `fetch` 或 `import`；在页面和交付说明中标明首次打开需要联网。
4. 用户要求离线单文件时，把 Three.js 运行时代码一并内联。用户要求接入现有项目时，才改用项目依赖和多文件结构。
5. 支持播放、暂停、重置、慢放和时间轴拖动。空间关系需要辨认内外或遮挡时增加镜头拖动；用法切换同步更新场景和语义反馈。
6. 文本标签优先使用 HTML overlay，避免把大段文字制作成 3D 纹理。
7. 处理画布尺寸变化、动画清理、几何体与材质释放，以及 `prefers-reduced-motion`。
8. 解析并校验内嵌 `SceneSpec`，检查 HTML 中只有预期的远程 Three.js 依赖。优先通过 `file://` 验证双击打开；本地静态服务器只作为额外检查。可用时再做真实浏览器检查。
9. 给出 HTML 文件路径，默认打开方式是直接双击；仅在用户明确说只要方案时省略实现。

完成标准：默认交付物只有一个 HTML；用户无需启动服务即可打开；内嵌 `SceneSpec` 可解析且是语义配置的单一来源；动画不越过事实边界；交互可用，资源正确释放。
