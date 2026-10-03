import type { ChannelSource } from 'gesso-framework';

import type { IssueDetailCommands, IssueDetailView } from './IssueDetailContract';
import type { IssueDetailService } from './IssueDetailService';

/** The detail channel, served from the service: what the app worker serves, and what a spec does. */
export function detailSource(detail: IssueDetailService): ChannelSource<IssueDetailView, IssueDetailCommands> {
  return {
    view: { detail: detail.detail, found: detail.found },
    commands: {
      open: key => detail.open(key),
      update: ({ patch, label }) => detail.update(patch, label),
      comment: body => detail.comment(body),
      find: query => detail.find(query),
      setParent: key => detail.setParent(key),
      addChild: key => detail.addChild(key),
      removeChild: key => detail.removeChild(key),
      link: ({ key, kind }) => detail.link(key, kind),
      unlink: id => detail.unlink(id)
    }
  };
}
