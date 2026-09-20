# lucide

> 在项目中使用 [lucide](https://lucide.dev) 图标

> 已同步 `v1.47.0` 版本

> `24 × 24` 的线框（stroke）图标，`svg` 资源

## 安装

```shell
ohpm install @isfk/lucide
```

## 使用

```ts
import { HouseIcon, LucideIcon } from '@isfk/lucide';

@Entry
@Component
struct Index {
  build() {
    Column({ space: 12 }) {
      LucideIcon().width(20).height(20)
      LucideIcon({ icon: HouseIcon }).width(20).height(20)
      LucideIcon({ icon: HouseIcon, color: Color.Red }).width(20).height(20)
    }
    .height('100%')
    .width('100%')
  }
}
```

## 关于颜色

lucide 是**描边型**图标（`fill="none"` + `stroke`），ArkUI 的 `fillColor` 对 `fill="none"` 的元素不生效，
所以 `LucideIcon` 内部改用 `colorFilter`（`BlendMode.SRC_IN`）给整张图统一着色：

- `color` 支持 `Color.Black` / `'#FF6699'` / `$r('app.color.xxx')` 等 `ResourceColor`
- 颜色作用在描边上，与 svg 里 `stroke` 的字面值无关

[GitHub地址](https://github.com/shenapps/octicons-harmony)
