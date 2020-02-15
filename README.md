# GitHub Action &ndash; Derive a Version Number

Calculate `patch` &ndash; the number of commits since the last
change in `major.minor` version.

## Usage

Create a file in your repository, usually called `VERSION`, and put
`major.minor` version in it.

    echo 1.0 >VERSION

Then use the action in your workflow.

    on: push
    jobs:
      release:
        runs-on: ubuntu-latest
        steps:
          - uses: avakar/derive-version@v1
            id: version
          - run: |
            mkdir _build
            cd _build
            cmake .. -DVERSION="${{ steps.version.outputs.version }}"
          - uses: avakar/tag-and-release@v1
            with:
              tag_name: ${{ steps.version.outputs.version }}

### Inputs

* `file`: the name of the version file; the contents of the file will be
  prepended to the calculated patch number. Defaults to `VERSION`
* `commit`: the commit for which the version should be derived,
  defaults to `HEAD`
* `deepen-by`: if the repo is too shallow for the calculation, deepen it
  by the specified number of commits, defaults to 100

### Outputs

* `patch`: the number of commits since the last change in the version file
* `version`: the same as `patch`, but prepended by the contents of the version
  file and a dot, e.g if the version file contains `1.0` and `patch` is `42`,
  this output will be set to `1.0.42`

## Patch Number Calculation

Formally, this action calculates the length of the longest path starting at
the specified commit C (usually `HEAD`) in a subgraph generated from
the commit graph by removing commits in which the contents of the version file
differs from the contents of the version file in C.

Let's break this down.

If the version file is called `VERSION`, which is recommended and the default
value for the `file` parameter, then commits in which you change the contents
of `VERSION` will have the patch number of 0. The next commit will have patch
number of 1, the next one 2, and so on until you modify `VERSION` again.
The patch number then resets back to 0.

The full version is `${VERSION}.${patch}`, if you put `major.minor`
in the `VERSION` file, the resulting version can be used as a semantic version
of the commit.

Here's how versions might look like in a linear graph (parents are to the left).

    0.1.0---0.1.1---0.1.2---0.9.0---0.9.1---1.0.0---1.0.1

And here's are some examples of a branching history.

    0.1.0---0.1.1-----------------------0.1.4
          \                          /
           \                        /
            --0.1.1---0.1.2---0.1.3-

    0.1.0---0.1.1---0.1.2---0.1.3-------0.1.4
          \                          /
           \                        /
            --0.1.1---0.1.2---0.1.3-

    0.1.0---0.1.1---0.2.0---0.2.1-------0.2.2
          \                          /
           \                        /
            --0.1.1---0.1.2---0.1.3-

Notice that although multiple commits can have the same version,
versions of commits on each linear path strictly decrease. Therefore,
pushing to a branch will always increase its version.
