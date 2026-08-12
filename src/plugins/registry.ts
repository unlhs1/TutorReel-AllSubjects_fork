import { ContentTypePlugin } from './types';
import { generalPlugin } from './general';

const plugins = new Map<string, ContentTypePlugin>();

function register(plugin: ContentTypePlugin): void {
  plugins.set(plugin.id, plugin);
}

register(generalPlugin);

export const registry = {
  register,
  get(id: string): ContentTypePlugin | undefined {
    return plugins.get(id);
  },
  getAll(): ContentTypePlugin[] {
    return Array.from(plugins.values());
  },
};
