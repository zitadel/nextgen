/** What `run` throws, or `undefined` when it returns. */
export const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** What `run` rejects with, or `undefined` when it resolves. */
export const rejectionOf = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};
