# octicons

> 在项目中使用 [octicons](https://github.com/primer/octicons) 图标

> 使用了尺寸为 `24` 的 `svg` 资源

## 安装

```shell
ohpm install @isfk/octicons
```

## 使用

```ts
import { AppsIcon, OctIcon } from '@isfk/octicons';

@Entry
@Component
struct Index {
  @State message: string = 'Hello World';

  build() {
    Column() {
      OctIcon().width(20).height(20)
      OctIcon({ icon: AppsIcon, color: Color.Red }).width(20).height(20)
    }
    .height('100%')
    .width('100%')
  }
}
```

[GitHub地址](https://github.com/shenapps/octicons-harmony)