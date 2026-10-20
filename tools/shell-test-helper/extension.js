// Testing only: installed into a throwaway HOME by tools/nested-test.sh.
// Never install this into a real session.
export default class {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
