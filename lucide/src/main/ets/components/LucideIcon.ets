import { ColorMetrics } from '@kit.ArkUI';
import { common2D, drawing } from '@kit.ArkGraphics2D';

/**
 * lucide 图标（24×24 线框型）。
 *
 * 与 octicons 的填充型图标不同，lucide 的 svg 是 `fill="none"` + `stroke="#000000"`：
 * ArkUI 的 `fillColor` 对 `fill="none"` 的元素不生效，所以这里改走 `colorFilter` 的
 * SRC_IN 混合模式给整张图重新着色 —— 传进来的 color 会作用在描边上。
 */
function toColorFilter(color: ResourceColor): drawing.ColorFilter {
  const m: ColorMetrics = ColorMetrics.resourceColor(color);
  const c: common2D.Color = {
    alpha: m.alpha,
    red: m.red,
    green: m.green,
    blue: m.blue,
  };
  return drawing.ColorFilter.createBlendModeColorFilter(c, drawing.BlendMode.SRC_IN);
}

@ComponentV2
export struct LucideIcon {
  @Param icon: string = 'lucide_house'
  @Param color: ResourceColor = Color.Black

  build() {
    Image($r(`app.media.${this.icon}`))
      .colorFilter(toColorFilter(this.color))
      .objectFit(ImageFit.Contain)
  }
}

@Preview
@Component
struct LucideIconPreview {
  build() {
    Row({ space: 12 }) {
      LucideIcon({ icon: 'lucide_house' })
        .width(40)
        .height(40)
      LucideIcon({ icon: 'lucide_arrow_down', color: Color.Red })
        .width(40)
        .height(40)
      LucideIcon({ icon: 'lucide_heart', color: '#FF6699' })
        .width(40)
        .height(40)
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }
}
