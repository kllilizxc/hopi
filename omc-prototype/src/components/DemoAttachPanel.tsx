import { useNavigate } from '@tanstack/react-router'
import { usePrototypeStore } from '@/prototype/store'
import { Glyph } from './Visuals'

export default function DemoAttachPanel() {
    const navigate = useNavigate()
    const { actions } = usePrototypeStore()

    return (
        <section className="flex flex-col items-center justify-center p-12 bg-white border border-zinc-200 rounded-xl shadow-sm max-w-lg mx-auto mt-20 gap-8">
            <div className="flex flex-col items-center text-center gap-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-100 text-zinc-900 shadow-sm border border-zinc-200">
                    <Glyph name="repo" />
                </div>
                <div className="flex flex-col items-center gap-1 mt-2">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">演示仓库</p>
                    <strong className="text-2xl font-bold text-zinc-900">PersonalQuant</strong>
                    <span className="text-sm text-zinc-500 mt-1">接入后直接进入经营盘</span>
                </div>
            </div>

            <div className="flex justify-center w-full">
                <button
                    type="button"
                    className="w-full sm:w-auto px-8 py-3 text-base font-medium text-white bg-zinc-900 rounded-xl shadow-md hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900"
                    onClick={() => {
                        actions.attachDemoProgram()
                        void navigate({ to: '/' })
                    }}
                >
                    进入演示
                </button>
            </div>
        </section>
    )
}
