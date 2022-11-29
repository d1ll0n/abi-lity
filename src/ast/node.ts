import { ASTContext } from "./ast_context";

export type NodeCallback<NodeType extends Node = Node> = (node: NodeType) => void;
export type NodeSelector<NodeType extends Node = Node> = (node: NodeType) => boolean;

export type NodeConstructor<T extends Node> = new (...args: any[]) => T;

let nNodes = 0;

/**
 * Modified from base AST class in solc-typed-ast
 * @author Joran Honig
 * @see https://github.com/consensys/solc-typed-ast/commit/af781125e6f083ef5e0b0f458325aa7b8271de35
 */
export class Node<NodeType extends Node = any> {
  private _context?: ASTContext;

  get context(): ASTContext | undefined {
    return this._context;
  }

  set context(ctx: ASTContext | undefined) {
    if (ctx !== this._context) {
      if (ctx && !ctx.contains(this)) {
        ctx.register(this);
        this.children.forEach((node) => {
          node.context = ctx;
        });
      }
      this._context = ctx;
    }
  }

  /**
   * Unique identifier number for the node in the tree context
   */
  id: number;

  /**
   * The AST node that is containing current node
   */
  parent?: NodeType;

  private _nodeCtor: NodeConstructor<NodeType> = Node as any;

  constructor() {
    this.id = nNodes++;
  }

  protected pickNodes(...args: Array<any | Iterable<any>>): NodeType[] {
    const result: NodeType[] = [];

    for (const arg of args) {
      if (arg instanceof this._nodeCtor) {
        result.push(arg);
      } else if (arg === null || arg === undefined || typeof arg === "string") {
        continue;
      } else if (typeof arg[Symbol.iterator] === "function") {
        result.push(...this.pickNodes(...arg));
      }
    }

    return result;
  }

  /**
   * Sets `parent` to the current node for each of the accessible children node.
   */
  acceptChildren(): void {
    for (const node of this.children) {
      node.parent = this;
      if (this.context) {
        node.context = this.context;
      }
    }
  }

  /**
   * Returns children nodes of the current node
   */
  get children(): readonly NodeType[] {
    return this.pickNodes();
  }

  /**
   * Returns the first immediate child of the node,
   * or `undefined` if the node has no children.
   */
  get firstChild(): NodeType | undefined {
    return this.children[0];
  }

  /**
   * Returns the last immediate child of the node,
   * or `undefined` if the node has no children.
   */
  get lastChild(): NodeType | undefined {
    return this.children[this.children.length - 1];
  }

  /**
   * Returns the node immediately preceding the current one
   * in its `parent`'s `children`.
   *
   * Returns `undefined` if the current node is the first child
   * in its `parent`'s children.
   */
  get previousSibling(): NodeType | undefined {
    if (this.parent === undefined) {
      return undefined;
    }

    const nodes = this.parent.children;
    const index = nodes.indexOf(this);

    return nodes[index - 1];
  }

  /**
   * Returns the node immediately following the current one
   * in its `parent`'s children.
   *
   * Returns `undefined` if the current node is the last child
   * in its `parent`'s children.
   */
  get nextSibling(): NodeType | undefined {
    if (this.parent === undefined) {
      return undefined;
    }

    const nodes = this.parent.children;
    const index = nodes.indexOf(this);

    return nodes[index + 1];
  }

  /**
   * Returns most parent node in tree hierarchy
   */
  get root(): NodeType {
    let node: NodeType = this as any;

    while (node.parent) {
      node = node.parent;
    }

    return node;
  }

  walk(callback: NodeCallback<NodeType>): void {
    const walker = this.createWalker(callback);

    walker(this as any);
  }

  walkChildren(callback: NodeCallback<NodeType>): void {
    const walker = this.createWalker(callback);

    for (const node of this.children) {
      walker(node);
    }
  }

  walkParents(callback: NodeCallback<NodeType>): void {
    let node: NodeType | undefined = this.parent;

    while (node) {
      callback(node);

      node = node.parent;
    }
  }

  getChildren(inclusive = false): NodeType[] {
    const nodes: NodeType[] = [];
    const callback: NodeCallback<NodeType> = (node) => {
      nodes.push(node);
    };

    if (inclusive) {
      this.walk(callback);
    } else {
      this.walkChildren(callback);
    }

    return nodes;
  }

  getChildrenBySelector<T extends NodeType>(
    selector: NodeSelector<NodeType>,
    inclusive = true
  ): T[] {
    const nodes: T[] = [];
    const callback: NodeCallback<NodeType> = (node) => {
      if (selector(node)) {
        nodes.push(node as T);
      }
    };

    if (inclusive) {
      this.walk(callback);
    } else {
      this.walkChildren(callback);
    }

    return nodes;
  }

  getChildrenByType<T extends NodeType>(type: NodeConstructor<T>, inclusive = false): T[] {
    return this.getChildrenBySelector((node) => node instanceof type, inclusive);
  }

  getChildrenByTypeString<T extends NodeType>(typeString: string, inclusive = false): T[] {
    return this.getChildrenBySelector((node) => node.constructor.name === typeString, inclusive);
  }

  getChildrenByProperty<T extends NodeType, K extends keyof T, V extends T[K]>(
    key: K,
    value: V,
    inclusive = false
  ): T[] {
    return this.getChildrenBySelector((node) => (node as T)[key] === value, inclusive);
  }

  getParents(): NodeType[] {
    const nodes: NodeType[] = [];

    this.walkParents((node) => {
      nodes.push(node);
    });

    return nodes;
  }

  getClosestParentBySelector<T extends NodeType>(selector: NodeSelector): T | undefined {
    let node = this.parent as T | undefined;

    while (node) {
      if (selector(node)) {
        return node;
      }

      node = node.parent as T | undefined;
    }

    return undefined;
  }

  getClosestParentByType<T extends NodeType>(type: NodeConstructor<T>): T | undefined {
    return this.getClosestParentBySelector((node) => node instanceof type);
  }

  getClosestParentByTypeString<T extends NodeType>(typeString: string): T | undefined {
    return this.getClosestParentBySelector((node) => node.constructor.name === typeString);
  }

  getParentsBySelector<T extends NodeType>(selector: NodeSelector): T[] {
    const nodes: T[] = [];
    const callback: NodeCallback = (node) => {
      if (selector(node as T)) {
        nodes.push(node as T);
      }
    };

    this.walkParents(callback);

    return nodes;
  }

  getFieldValues(): Map<string, any> {
    return new Map(Object.entries(this));
  }

  getGettersValues(): Map<string, any> {
    const getters: string[] = [];

    let proto = Object.getPrototypeOf(this);

    while (proto) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "__proto__") {
          continue;
        }

        const descriptor = Object.getOwnPropertyDescriptor(proto, name);

        if (descriptor && typeof descriptor.get === "function" && !getters.includes(name)) {
          getters.push(name);
        }
      }

      proto = Object.getPrototypeOf(proto);
    }

    const result = new Map<string, any>();

    for (const g of getters) {
      result.set(g, this[g as keyof this]);
    }

    return result;
  }

  private createWalker(callback: NodeCallback<NodeType>): NodeCallback<NodeType> {
    const walker: NodeCallback<NodeType> = (node) => {
      callback(node);

      for (const child of node.children) {
        walker(child);
      }
    };

    return walker;
  }
}

/**
 * Replace the node `oldNode` in the tree with `newNode`.
 *
 * If `p` is the parent of `oldNode`, this function needs to find a property
 * `propName` of `p` such that `p[propName] === oldNode`.
 *
 * Once found, it re-assigns `p[propName] = newNode` and sets
 * `newNode.parent=p` using `acceptChildren`. Since `children` is a getter
 * there is nothing further to do.
 */
export function replaceNode(oldNode: Node, newNode: Node): void {
  const parent = oldNode.parent;

  if (parent === undefined) {
    return;
  }

  const ownProps = Object.getOwnPropertyDescriptors(parent);

  for (const name in ownProps) {
    const val = ownProps[name].value;

    if (val === oldNode) {
      const tmpObj: any = {};

      tmpObj[name] = newNode;

      Object.assign(parent, tmpObj);

      oldNode.parent = undefined;

      parent.acceptChildren();

      return;
    }

    if (val instanceof Array) {
      for (let i = 0; i < val.length; i++) {
        if (val[i] === oldNode) {
          val[i] = newNode;

          oldNode.parent = undefined;

          parent.acceptChildren();

          return;
        }
      }
    }

    if (val instanceof Map) {
      for (const [k, v] of val.entries()) {
        if (v === oldNode) {
          val.set(k, newNode);

          oldNode.parent = undefined;

          parent.acceptChildren();

          return;
        }
      }
    }
  }

  throw new Error(
    `Couldn't find child ${oldNode.constructor.name}#${oldNode.id} under parent ${parent.constructor.name}#${parent.id}`
  );
}
