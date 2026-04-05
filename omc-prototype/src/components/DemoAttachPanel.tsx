import { useNavigate } from '@tanstack/react-router'
import { usePrototypeStore } from '@/prototype/store'
import { Glyph } from './Visuals'

export default function DemoAttachPanel() {
    const navigate = useNavigate()
    const { actions } = usePrototypeStore()

    return (
        <section className="prototype-panel prototype-attach">
            <div className="prototype-attach__hero">
                <div className="prototype-attach__preview">
                    <div className="prototype-icon-pill prototype-icon-pill--large">
                        <Glyph name="repo" />
                    </div>
                    <p className="prototype-eyebrow">演示仓库</p>
                    <strong>PersonalQuant</strong>
                    <span>接入后直接进入经营盘</span>
                </div>
            </div>

            <div className="prototype-inline-actions">
                <button
                    type="button"
                    className="prototype-primary-button"
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
