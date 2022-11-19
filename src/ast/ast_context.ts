// import { deepFindIn } from "../misc";
import { Node, NodeCallback, NodeSelector } from "./node";

function* sequence(start = 0, step = 1): Generator<number, number, number> {
  while (true) {
    yield (start += step);
  }
}

const contextIdSequence = sequence();

export class ASTContext {
  /**
   * ID to distinct different contexts
   */
  id = contextIdSequence.next().value;

  /**
   *  Temporary workaround
   */
  readonly yulIdStart = 1e5;
  lastYulId = this.yulIdStart;

  /**
   * Map from ID number to the `AST` node with same ID in tree
   */
  map = new Map<number, Node>();

  constructor(...nodes: Node[]) {
    this.register(...nodes);
  }

  /**
   * Max ID of the registered nodes
   */
  get lastId(): number {
    let last = 0;

    for (const id of this.map.keys()) {
      if (id >= this.yulIdStart) {
        continue;
      }
      if (id > last) {
        last = id;
      }
    }

    return last;
  }

  get nodes(): Iterable<Node> {
    return this.map.values();
  }

  register(...nodes: Node[]): void {
    for (const node of nodes) {
      if (this.map.has(node.id)) {
        throw new Error(`The id ${node.id} is already taken for the context`);
      }

      if (node.context) {
        node.context.unregister(node);
      }

      this.map.set(node.id, node);

      node.context = this;
    }
  }

  unregister(...nodes: Node[]): void {
    for (const node of nodes) {
      if (!this.contains(node)) {
        throw new Error(`Supplied node with id ${node.id} not belongs to the context`);
      }

      this.map.delete(node.id);

      node.context = undefined;
    }
  }

  locate(id: number): Node {
    return this.map.get(id) as Node;
  }

  require(id: number): Node {
    const node = this.locate(id);

    if (node) {
      return node;
    }

    throw new Error("Required node not found for id " + id);
  }

  contains(node: Node): boolean {
    return this.locate(node.id) === node;
  }

  getNodesBySelector<T extends Node>(selector: NodeSelector<Node>): T[] {
    return [...this.map.values()].filter(selector) as T[];
  }
}
