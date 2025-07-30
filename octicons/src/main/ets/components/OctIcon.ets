@ComponentV2
export struct OctIcon {
  @Param icon: string = 'home_24'
  @Param color: ResourceColor = Color.Black

  build() {
    Image($r(`app.media.${this.icon}`))
      .fillColor(this.color)
      .objectFit(ImageFit.Cover)
  }
}

@Preview
struct OctIconPreview {
  build() {
    Row() {
      OctIcon({ color: Color.Red })
        .width(50)
        .height(50)
      OctIcon({ icon: 'person_24', color: Color.Blue })
        .width(50)
        .height(50)
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }
}
