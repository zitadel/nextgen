import {
  getCreateFlowMockHandler,
  getCreateFlowResponseMock,
} from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.msw";
import { CreateFlowBody } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";
import { CreateFlow201 } from "@zitadel-nextgen/api/generated/model";
import { SetupWorker } from "msw/browser";
import { createActor, createMachine } from "xstate";

export function setupMock(worker: SetupWorker) {
  const machine = createMachine({
    context: {},
    on: {
      login: {},
    },
  });

  const actor = createActor(machine);
  actor.start();

  worker.use(
    getCreateFlowMockHandler(async (request): Promise<CreateFlow201> => {
      const req = CreateFlowBody.parse(await request.request.json());

      const state = actor.getSnapshot();
      console.log(state.value, req);

      return getCreateFlowResponseMock();
    }),
  );
}
