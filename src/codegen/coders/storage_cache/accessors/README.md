# Accessor Options Generation

In these files, we generate many possible ways to get/set a particular field in memory, then based on the user's preference for gas/codesize optimization, determine the best option.

In reality, we don't need to generate every option - we could do simple analysis to pick the ideal option for each scenario, and in many cases there are specific optimal solutions regardless of the user's preferences. The purpose of generating all these options is for future reference, when we have more complex kinds of accessors, e.g. from one spot in memory to another, or reading/writing several fields at once.

## TODO

Generate tests for all options
