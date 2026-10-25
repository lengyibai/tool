declare module "gif.js/dist/gif.js" {
  import Gif = require("gif.js");
  export = Gif;
}

declare module "gif.js/dist/gif.worker.js?url" {
  const url: string;
  export default url;
}
