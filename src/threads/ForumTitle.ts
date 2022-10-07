import {
  TreeDataProvider,
  Event,
  EventEmitter,
  TreeItem,
  ProviderResult,
  TreeItemCollapsibleState,
  ThemeIcon,
  Uri,
  workspace,
} from "vscode";
import { Credential, S1URL } from "../types/S1types";
import * as cheerio from "cheerio";
import got from "got";
import { CookieJar } from "tough-cookie";
import { checkAuth } from "../libs/auth";

export class ForumTitleProvider
  implements
  TreeDataProvider<StageOneTreeItem>
{
  private _onDidChangeTreeData: EventEmitter<
    StageOneTreeItem | undefined | void
  > = new EventEmitter<
    StageOneTreeItem | undefined | void
  >();

  readonly onDidChangeTreeData: Event<
    StageOneTreeItem | undefined | void
  > = this._onDidChangeTreeData.event;

  public accounts: AccountTitle | undefined;

  constructor(private cookieJar: CookieJar, public credential: Credential) { }

  public opens1Users: Set<string> = new Set();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateView(
    element: StageOneTreeItem
  ): void {
    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(
    element: StageOneTreeItem
  ): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(
    element?: StageOneTreeItem | undefined
  ): ProviderResult<(StageOneTreeItem)[]> {
    if (element && element instanceof BoardTitle) {
      return this.getForumEntries(element);
    } else if (
      element &&
      (element instanceof ThreadTitle || element instanceof OnlineUser)
    ) {
      // ThreadTitle won't call getChildren as it's collapseState is set to None.
      // This condition block can be ignored.
      return [];
    } else if (element && element instanceof AccountTitle) {
      return Promise.resolve(
        Array.from(this.opens1Users.keys()).map(
          (user) =>
            new OnlineUser(
              user,
              user === this.credential.username,
              TreeItemCollapsibleState.None
            )
        )
      );
    } else if (element && element instanceof FavoriteTitle) {
      const conf = workspace.getConfiguration("opens1");
      const favorites = conf.get<string[]>("favorites");
    } else {
      return this.getForumEntries().then((boardTitles) => {
        const favorites = new FavoriteTitle(TreeItemCollapsibleState.Collapsed);
        var titles: StageOneTreeItem[] = [...boardTitles, favorites];
        return checkAuth(this.cookieJar).then((auth) => {
          if (auth) {
            this.accounts = new AccountTitle(
              "OpenS1用户",
              // `OpenS1用户(${this.opens1Users.size}人)`,
              TreeItemCollapsibleState.Collapsed
            );
            titles = [...titles, this.accounts];
          }
          return titles;
        });
      });
    }
  }

  private async getForumEntries(
    element?: ThreadTitle | BoardTitle | undefined
  ): Promise<(ThreadTitle | BoardTitle)[]> {
    const fetchURL: string = element
      ? `${S1URL.host}/archiver/${element.path}?page=${element.page}`
      : `${S1URL.host}/archiver/`;
    let forumDoc: string;
    try {
      forumDoc = await got(fetchURL, { cookieJar: this.cookieJar }).text();
    } catch (error) {
      console.error(error);
      return [];
    }

    const $: cheerio.CheerioAPI = cheerio.load(forumDoc);
    // const content = $('#content li a').map((i, el) => {
    //   const title = $(el).text();
    //   return title;
    // }).get();
    // console.log(content);

    const entries = $("#content li")
      .map((i, el) => {
        const path: string = $(el).children("a").attr("href") || "#";
        const title: string = $(el).text().trim();
        const conf =
          workspace.getConfiguration("opens1").get<string[]>("hiddenBoards") ||
          [];
        if (path.includes("fid-") && !conf.includes(title)) {
          return new BoardTitle(
            title,
            path,
            TreeItemCollapsibleState.Collapsed
          );
        } else if (path.includes("tid-")) {
          $(el).children("a").remove();
          const replies: number = Number($(el).text().trim().slice(1, -4));
          const fid: number = Number(element ? element.path.slice(4, -5) : 0);
          return new ThreadTitle(
            title,
            path,
            fid,
            replies,
            TreeItemCollapsibleState.None
          );
        }
      })
      .get();
    return entries;
  }

  turnBoardPage(element: BoardTitle, page: number) {
    if (page >= 1 && page <= 10) {
      element.page = page;
      element.description = ` Page ${page}`;
      element.tooltip = `${element.title} page ${page}`;
      element.contextValue = `boardp${page}`;
      this.updateView(element);
    }
  }

  turnThreadPage(element: ThreadTitle, page: number) {
    if (page >= 1 && page <= element.pagination) {
      element.page = page;
      element.description = ` Page ${page}/${element.pagination}`;
      element.tooltip = `${element.title} page ${page}/${element.pagination}`;
      // element.contextValue = `threadp${page}`;
      element.contextValue =
        element.pagination === 1
          ? `threadp0`
          : page >= element.pagination
            ? `threadpend`
            : `threadp${page}`;
      element.threadUri = Uri.parse(
        `s1:${element.path.slice(4, -5)}-${page}.${element.ext}`
      );
      this.updateView(element);
    }
  }
}

class StageOneTreeItem extends TreeItem {
  constructor(
    public readonly title: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
  }
}

export class TopTreeItem extends TreeItem {
  constructor(
    public readonly title: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
  }
}

export class ThreadTitle extends StageOneTreeItem {
  constructor(
    public readonly title: string,
    public readonly path: string,
    public readonly fid: number,
    public readonly replies: number,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
    this.tooltip = this.title;
    // this.description = this.link.slice(0,-5);
    // this.description = `Page ${this.page}/${this.pagination}`;
    this.contextValue =
      this.pagination === 1
        ? `threadp0`
        : this.page >= this.pagination
          ? `threadpend`
          : `threadp${this.page}`;
    this.command = {
      title: "Show Thread",
      command: "opens1.showthread",
      arguments: [this],
      // arguments: [Uri.parse(`s1:${this.path}?page=${this.page}`)]
    };
  }

  public page: number = 1;
  public pagination: number =
    this.replies === 0 ? 1 : Math.ceil(this.replies / 30);

  private displayStyle = workspace
    .getConfiguration("opens1")
    .get<string>("threadDisplayStyle");

  public ext: string =
    this.displayStyle === "markdown"
      ? "md"
      : this.displayStyle === "typescript"
        ? "ts"
        : this.displayStyle === "python"
          ? "py"
          : this.displayStyle === "cpp"
            ? "cc"
            : "md";

  public threadUri: Uri = Uri.parse(
    `s1:${this.path.slice(4, -5)}-${this.page}.${this.ext}`
  );

  public readonly tid: number = Number(this.path.slice(4, -5));
}

export class BoardTitle extends TopTreeItem {
  constructor(
    public readonly title: string,
    public readonly path: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
    this.tooltip = this.title;
    // this.description = this.link.slice(0,-5);
    // this.description = "";
    this.contextValue = `boardp${this.page}`;
    // this.command = {
    //   title: "Update view",
    //   command: "opens1.updateview",
    //   arguments: [this],
    // };
  }

  iconPath = new ThemeIcon("comment-discussion");

  public page: number = 1;
  public readonly fid: number = Number(this.path.slice(4, -5));
}

export class FavoriteTitle extends TopTreeItem {
  constructor(
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super("收藏", collapsibleState);
  }

  iconPath = new ThemeIcon("star");
}

export class AccountTitle extends TopTreeItem {
  constructor(
    public readonly title: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
    this.contextValue = `boarduser`;
  }

  iconPath = new ThemeIcon("account");
}

export class OnlineUser extends StageOneTreeItem {
  constructor(
    public readonly username: string,
    public readonly isMe: boolean,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(isMe ? `${username}(Me)` : username, collapsibleState);
    this.contextValue = `onlineusers`;
  }

  iconPath = new ThemeIcon("account");
}
