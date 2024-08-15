import chalk from "chalk";

const green = chalk.hex("#abe338");
const blue = chalk.hex("#00e0e0");
const purple = chalk.hex("#dcc6e0");
const comment = chalk.hex("#d4d0ab");
const red = chalk.hex("#ffa07a");
const orange = chalk.hex("#f5ab35");

export const YulTheme = {
  comment,
  quote: comment,
  variable: red,
  "template-variable": red,
  tag: red,
  name: red,
  "selector-id": red,
  "selector-class": red,
  regexp: red,
  deletion: red,

  number: orange,
  built_in: orange,
  literal: orange,
  type: orange,
  params: orange,
  meta: orange,
  link: orange,
  attribute: chalk.hex("#ffd700"),

  string: green,
  symbol: green,
  bullet: green,
  addition: green,

  title: blue,
  section: blue,
  keyword: purple,
  "selector-tag": purple,

  emphasis: chalk.italic,

  strong: chalk.bold
};
