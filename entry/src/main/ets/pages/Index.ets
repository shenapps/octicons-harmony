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